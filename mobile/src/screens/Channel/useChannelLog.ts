import { Code, ConnectError } from "@connectrpc/connect";
import { forgetItems, hasPage, nextSince } from "@stoop/core/channelLog";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChannelGone, loadChanges, loadChannel, loadHeader, loadOlder } from "../../api/messages";
import { sessionToken } from "../../api/servers";
import { useServerEvents } from "../../realtime/RealtimeProvider";
import type { SavedServer } from "../../servers";
import { type ChannelAction, type ChannelState, channelReducer, initialState, type Outcome } from "./state";

// The channel screen's log while it is on screen: opened on the newest
// page, grown by a page as the reader scrolls up, kept current by the
// realtime socket's events, and after a reconnect or a gap in the events
// caught up with ListChanges from the position it holds (never by
// fetching what is held again). The rules are the channel log's
// (core/channelLog); this hook makes the requests and dispatches each
// answer to state.ts. The log is this screen's alone and goes with it.

const RETRY_BASE_MS = 1000;
const RETRY_CAP_MS = 15_000;

// Why a load failed, as the screen shows it.
function outcomeOf(err: unknown): Outcome {
  if (err instanceof ChannelGone) return "gone";
  if (err instanceof ConnectError && err.code === Code.Unauthenticated) return "ended";
  if (err instanceof ConnectError && (err.code === Code.NotFound || err.code === Code.PermissionDenied)) return "gone";
  return "failed";
}

// A refusal that won't change, so a catch-up stops asking.
const final = (err: unknown) => err instanceof ConnectError && err.code === Code.InvalidArgument;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A reducer whose latest state a request can read as soon as it is
// dispatched, not only after React renders it.
function useStore(channelId: string) {
  const [state, setState] = useState(() => initialState(channelId));
  const latest = useRef(state);
  const dispatch = useCallback((action: ChannelAction) => {
    latest.current = channelReducer(latest.current, action);
    setState(latest.current);
  }, []);
  return { state, dispatch, latest };
}

export function useChannelLog(server: SavedServer, spaceId: string, channelId: string) {
  const { state, dispatch, latest } = useStore(channelId);
  // The screen has gone: nothing that answers now is anyone's.
  const left = useRef(false);
  const catchingUp = useRef(false);

  // ListChanges from the log's position, page after page while the server
  // has more, until the log owes nothing: one run at a time. A failure
  // leaves the catch-up owed and asks again after a growing wait; a
  // refusal that means the channel is gone or the sign-in has ended shows
  // as such.
  const catchUp = useCallback(async () => {
    if (catchingUp.current) return;
    catchingUp.current = true;
    let delay = RETRY_BASE_MS;
    try {
      for (;;) {
        const { log, token } = latest.current;
        if (left.current || !token || !log.needsCatchUp || !hasPage(log)) return;
        try {
          let since = log.seq;
          for (;;) {
            const res = await loadChanges(server.origin, token, channelId, since);
            if (left.current) return;
            dispatch({ type: "caughtUp", res });
            if (!res.hasMore) break;
            since = nextSince(since, res);
          }
          delay = RETRY_BASE_MS;
        } catch (err) {
          if (left.current || final(err)) return;
          const outcome = outcomeOf(err);
          if (outcome !== "failed") {
            dispatch({ type: "failed", outcome });
            return;
          }
          await sleep(delay);
          delay = Math.min(delay * 2, RETRY_CAP_MS);
        }
      }
    } finally {
      catchingUp.current = false;
    }
  }, [server.origin, channelId, dispatch, latest]);

  // The header and the newest page. The log is held from the start, so
  // events about the channel have somewhere to go meanwhile; the page's
  // position says whether one of them is still owed.
  const open = useCallback(async () => {
    const token = await sessionToken(server.id).catch(() => null);
    if (left.current) return;
    if (!token) {
      dispatch({ type: "failed", outcome: "ended" });
      return;
    }
    try {
      const { header, page } = await loadChannel(server.origin, token, spaceId, channelId);
      if (left.current) return;
      dispatch({ type: "opened", header, res: page, token });
      if (latest.current.log.needsCatchUp) void catchUp();
    } catch (err) {
      if (!left.current) dispatch({ type: "failed", outcome: outcomeOf(err) });
    }
  }, [server, spaceId, channelId, dispatch, latest, catchUp]);

  // After a reconnect the header's facts may have changed too (a rename,
  // a member count), and the channel may be gone.
  const refreshHeader = useCallback(async () => {
    const { token } = latest.current;
    try {
      const header = await loadHeader(server.origin, token, spaceId, channelId);
      if (!left.current) dispatch({ type: "header", header });
    } catch (err) {
      const outcome = outcomeOf(err);
      if (!left.current && outcome !== "failed") dispatch({ type: "failed", outcome });
    }
  }, [server.origin, spaceId, channelId, dispatch, latest]);

  useEffect(() => {
    left.current = false;
    void open();
    return () => {
      left.current = true;
      forgetItems(channelId);
    };
  }, [open, channelId]);

  useServerEvents(server.id, (event) => {
    if (event.payload.case !== "ready") {
      dispatch({ type: "event", event });
      if (latest.current.log.needsCatchUp) void catchUp();
      return;
    }
    // The socket is back. A channel not yet open is opened again, since a
    // load still out may have read the server before the socket was; one
    // that is open owes a catch-up from where it stands.
    const { header, outcome } = latest.current;
    if (outcome === "ended" || outcome === "gone") return;
    if (!header) {
      void open();
      return;
    }
    dispatch({ type: "reconnected" });
    void catchUp();
    void refreshHeader();
  });

  // The page above the oldest message held, once at a time.
  const older = useCallback(async () => {
    const { log, token, loadingOlder } = latest.current;
    const view = log.channel;
    if (loadingOlder || !token || !view.hasOlder || !view.oldestId) return;
    dispatch({ type: "pagingOlder" });
    try {
      const res = await loadOlder(server.origin, token, channelId, view.oldestId);
      if (!left.current) dispatch({ type: "paged", res, generation: view.generation });
    } catch {
      if (!left.current) dispatch({ type: "pageFailed" });
    }
  }, [server.origin, channelId, dispatch, latest]);

  const retry = useCallback(() => {
    dispatch({ type: "retried" });
    void open();
  }, [dispatch, open]);

  return { state, older, retry };
}

export type { ChannelState };
