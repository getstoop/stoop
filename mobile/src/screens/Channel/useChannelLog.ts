import { Code, ConnectError } from "@connectrpc/connect";
import { type ChannelLog, channelItems, forgetItems, hasPage, LOG_CAP, nextSince } from "@stoop/core/channelLog";
import { type ChannelScreen, emptyScreen, type Outcome, type ScreenAction, screenReducer } from "@stoop/core/channelScreen";
import { toggledReactions } from "@stoop/core/reactions";
import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  ChannelGone,
  deleteMessage,
  editMessage,
  loadChanges,
  loadChannel,
  loadHeader,
  loadOlder,
  PAGE,
  sendMessage,
  toggleReaction,
} from "../../api/messages";
import { sessionToken } from "../../api/servers";
import { useServerEvents } from "../../realtime/RealtimeProvider";
import type { SavedServer } from "../../servers";

// The channel screen's log while it is on screen: opened on the newest
// page, grown by a page as the reader scrolls up, kept current by the
// realtime socket's events, and after a reconnect or a gap in the events
// caught up with ListChanges from the position it holds (never by
// fetching what is held again). The rules are the channel log's
// (core/channelLog) and the screen's state over it core/channelScreen's;
// this hook makes the requests and dispatches each answer. The log is
// this screen's alone and goes with it.

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

// A refusal that means the sign-in has ended. For a request about one
// message that is the only answer that says anything about the screen:
// NotFound is the message's, not the channel's, and PermissionDenied says
// what the reader may do to it.
const ended = (err: unknown) => err instanceof ConnectError && err.code === Code.Unauthenticated;

// Whether another older page fits. A view holds at most LOG_CAP rows and
// a page past that prunes the newest, the edge this screen keeps live
// (web shows a pill back to it; this screen has no way back yet), so its
// history ends a page short of the cap and the screen says so.
export const olderFits = (log: ChannelLog) => channelItems(log).length + PAGE <= LOG_CAP;

// What the requests out for the screen answer to: one lifetime per
// channel it shows, ended when it leaves the channel or goes. A request
// reads the lifetime it was made under when it lands and dispatches
// nothing once that has ended, so a page for the channel before never
// reaches this one's store, and a catch-up running for it stops at its
// next step. A send's answer is the one exception: the row went into
// the channel whatever screen is showing, so it is merged as long as
// the store is this channel's.
type Lifetime = {
  ended: boolean;
  // The open whose answer is wanted. An earlier one still out (a Ready
  // opened again while it was out) is dropped whichever lands first,
  // its failure too.
  opens: number;
  catchingUp: boolean;
  // Ends a catch-up's wait before a retry early, when the socket is back.
  wake: (() => void) | null;
};

const newLifetime = (): Lifetime => ({ ended: false, opens: 0, catchingUp: false, wake: null });

// The screen's state, whose latest value a request can read as soon as an
// action is dispatched, not only after React renders it. Another channel
// in the same screen starts afresh, in the same render.
function useStore(channelId: string) {
  const [state, setState] = useState(() => emptyScreen(channelId));
  const latest = useRef(state);
  if (latest.current.log.channelId !== channelId) {
    latest.current = emptyScreen(channelId);
    setState(latest.current);
  }
  const dispatch = useCallback((action: ScreenAction) => {
    latest.current = screenReducer(latest.current, action);
    setState(latest.current);
  }, []);
  return { state, dispatch, latest };
}

export function useChannelLog(server: SavedServer, spaceId: string, channelId: string) {
  const { state, dispatch, latest } = useStore(channelId);
  const life = useRef<Lifetime>(newLifetime());

  const rest = (mine: Lifetime, ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        mine.wake = null;
        resolve();
      }
      mine.wake = done;
    });

  // ListChanges from the log's position, page after page while the server
  // has more, until the log owes nothing: one run at a time. A failure
  // leaves the catch-up owed and asks again after a growing wait, which
  // the socket's Ready cuts short. In the background the sockets are
  // closed (RealtimeProvider; "inactive", the app switcher or a system
  // sheet, keeps them), so the run ends and the Ready on coming back
  // starts another. A refusal that means the channel is gone or the
  // sign-in has ended shows as such.
  const catchUp = useCallback(async () => {
    const mine = life.current;
    if (mine.catchingUp) return;
    mine.catchingUp = true;
    let delay = RETRY_BASE_MS;
    try {
      for (;;) {
        const { log, token } = latest.current;
        if (mine.ended || !token || !log.needsCatchUp || !hasPage(log)) return;
        if (AppState.currentState === "background") return;
        try {
          let since = log.seq;
          for (;;) {
            const res = await loadChanges(server.origin, token, channelId, since);
            if (mine.ended) return;
            dispatch({ type: "caughtUp", res });
            if (!res.hasMore || res.messages.length === 0) break;
            since = nextSince(since, res);
          }
          delay = RETRY_BASE_MS;
        } catch (err) {
          if (mine.ended || final(err)) return;
          const outcome = outcomeOf(err);
          if (outcome !== "failed") {
            dispatch({ type: "failed", outcome });
            return;
          }
          await rest(mine, delay);
          delay = Math.min(delay * 2, RETRY_CAP_MS);
        }
      }
    } finally {
      mine.catchingUp = false;
    }
  }, [server.origin, channelId, dispatch, latest]);

  // The header and the newest page. The latest open is the one whose
  // answer is wanted: a Ready while this one is out opens again, since
  // this one may have read the server before the socket was back, and
  // then this answer is dropped whether it lands before or after. The
  // log is held from the start, so events about the channel have
  // somewhere to go meanwhile; the page's position says whether one of
  // them is still owed.
  const open = useCallback(async () => {
    const mine = life.current;
    const attempt = ++mine.opens;
    const stale = () => mine.ended || mine.opens !== attempt;
    const token = await sessionToken(server.id).catch(() => null);
    if (stale()) return;
    if (!token) {
      dispatch({ type: "failed", outcome: "ended" });
      return;
    }
    const generation = latest.current.log.channel.generation;
    try {
      const { header, page } = await loadChannel(server.origin, token, spaceId, channelId);
      if (stale()) return;
      dispatch({ type: "opened", header, res: page, token, generation });
      if (latest.current.log.needsCatchUp) void catchUp();
    } catch (err) {
      if (!stale()) dispatch({ type: "failed", outcome: outcomeOf(err) });
    }
  }, [server, spaceId, channelId, dispatch, latest, catchUp]);

  // After a reconnect the header's facts may have changed too (a rename,
  // a member count), and the channel may be gone.
  const refreshHeader = useCallback(async () => {
    const mine = life.current;
    const { token } = latest.current;
    try {
      const header = await loadHeader(server.origin, token, spaceId, channelId);
      if (!mine.ended) dispatch({ type: "header", header });
    } catch (err) {
      const outcome = outcomeOf(err);
      if (!mine.ended && outcome !== "failed") dispatch({ type: "failed", outcome });
    }
  }, [server.origin, spaceId, channelId, dispatch, latest]);

  useEffect(() => {
    life.current = newLifetime();
    void open();
    return () => {
      const mine = life.current;
      mine.ended = true;
      mine.wake?.();
      forgetItems(channelId);
    };
  }, [open, channelId]);

  useServerEvents(server.id, (event) => {
    if (event.payload.case !== "ready") {
      dispatch({ type: "event", event });
      if (latest.current.log.needsCatchUp) void catchUp();
      // A new role for the reader says nothing about what it permits; the
      // header fetched again carries the space's my_permissions.
      const { header } = latest.current;
      if (
        event.payload.case === "memberRoleChanged" &&
        header &&
        event.payload.value.spaceId === header.space.id &&
        event.payload.value.userId === header.myUserId
      )
        void refreshHeader();
      return;
    }
    // The socket is back. A channel not yet open is opened again, since a
    // load still out may have read the server before the socket was; one
    // that is open owes a catch-up from where it stands, and a catch-up
    // waiting to retry goes now.
    const { header, outcome } = latest.current;
    if (outcome === "ended" || outcome === "gone") return;
    if (!header) {
      void open();
      return;
    }
    dispatch({ type: "reconnected" });
    life.current.wake?.();
    void catchUp();
    void refreshHeader();
  });

  // The page above the oldest message held, once at a time, while one fits.
  const older = useCallback(async () => {
    const mine = life.current;
    const { log, token, loadingOlder } = latest.current;
    const view = log.channel;
    if (loadingOlder || !token || !view.hasOlder || !view.oldestId || !olderFits(log)) return;
    dispatch({ type: "pagingOlder" });
    try {
      const res = await loadOlder(server.origin, token, channelId, view.oldestId);
      if (!mine.ended) dispatch({ type: "paged", res, generation: view.generation });
    } catch {
      if (!mine.ended) dispatch({ type: "pageFailed" });
    }
  }, [server.origin, channelId, dispatch, latest]);

  const retry = useCallback(() => {
    dispatch({ type: "retried" });
    void open();
  }, [dispatch, open]);

  // The reader's own message, quoting another when replyToMessageId
  // names one: sent, then its answer merged like an event (the socket's
  // copy usually lands first; the log keeps one row either way). Nothing
  // is shown before the server answers. A refusal that means the channel
  // is gone or the sign-in has ended shows as such, like any other
  // request's; every other failure is the caller's to show, and the
  // composer puts the draft and the quote back.
  const send = useCallback(
    async (content: string, replyToMessageId = "") => {
      const mine = life.current;
      let message: Message;
      try {
        message = await sendMessage(server.origin, latest.current.token, channelId, content, replyToMessageId);
      } catch (err) {
        const outcome = outcomeOf(err);
        if (!mine.ended && outcome !== "failed") dispatch({ type: "failed", outcome });
        throw err;
      }
      if (latest.current.log.channelId === channelId) dispatch({ type: "sent", message });
    },
    [server.origin, channelId, dispatch, latest],
  );

  // The reader's own reaction, as web toggles one: written to the held
  // row at once (core/channelScreen `reacted`, at the row's own seq, so
  // the reactions_changed that follows replaces it), then ToggleReaction,
  // whose answer is merged like a send's. An answer with no row is a
  // toggle saved whose reload failed (api/messages toggleReaction): the
  // patch stands, with no event to follow it, and nothing is said. A
  // refusal puts the reactions back, unless the row has moved on
  // meanwhile, and is the caller's to show; one that means the sign-in
  // has ended shows as such. Once this screen has left the channel
  // (mine.ended) the answer, whichever it is, is nobody's: the log is
  // gone, and a notice would land on whatever screen came next.
  const react = useCallback(
    async (message: Message, emoji: string) => {
      const mine = life.current;
      const { header, token } = latest.current;
      if (!header || !token) return;
      const before = message.reactions;
      const patch = (reactions: typeof before): ScreenAction => ({
        type: "reacted",
        messageId: message.id,
        seq: message.seq,
        reactions,
      });
      dispatch(patch(toggledReactions(before, emoji, header.myUserId)));
      let answer: Message | undefined;
      try {
        answer = await toggleReaction(server.origin, token, message.id, emoji);
      } catch (err) {
        if (mine.ended) return;
        if (latest.current.log.channelId === channelId) dispatch(patch(before));
        if (ended(err)) dispatch({ type: "failed", outcome: "ended" });
        throw err;
      }
      if (answer && !mine.ended && latest.current.log.channelId === channelId) {
        dispatch({ type: "sent", message: answer });
      }
    },
    [server.origin, channelId, dispatch, latest],
  );

  // The reader's own delete, confirmed already: DeleteMessage, then the
  // held row hidden at once (core/channelScreen `deleted`), as the
  // message_deleted that follows makes it. A message already gone from
  // under the confirm (deleted elsewhere while it was open) is nothing to
  // ask for again. A refusal is the caller's to show, as above, and
  // nothing once this screen has left the channel.
  const remove = useCallback(
    async (message: Message) => {
      const mine = life.current;
      const { token, log } = latest.current;
      const held = log.rows.get(message.id);
      if (!token || (held && held.deleted)) return;
      try {
        await deleteMessage(server.origin, token, message.id);
      } catch (err) {
        if (mine.ended) return;
        if (ended(err)) dispatch({ type: "failed", outcome: "ended" });
        throw err;
      }
      if (!mine.ended && latest.current.log.channelId === channelId) {
        dispatch({ type: "deleted", messageId: message.id });
      }
    },
    [server.origin, channelId, dispatch, latest],
  );

  // The reader's own message with new words: EditMessage, then its answer
  // merged like a send's (the message_updated that follows says the same
  // at the same seq; either order leaves one row). Nothing is shown
  // before the server answers. A refusal is the caller's to show and is
  // always thrown, as a send's is, so one landing after this lifetime
  // has ended is never taken for a save; one that means the sign-in has
  // ended shows as such while the screen is still here.
  const edit = useCallback(
    async (messageId: string, content: string) => {
      const mine = life.current;
      let message: Message;
      try {
        message = await editMessage(server.origin, latest.current.token, messageId, content);
      } catch (err) {
        if (!mine.ended && ended(err)) dispatch({ type: "failed", outcome: "ended" });
        throw err;
      }
      if (!mine.ended && latest.current.log.channelId === channelId) dispatch({ type: "sent", message });
    },
    [server.origin, channelId, dispatch, latest],
  );

  return { state, older, retry, send, react, remove, edit };
}

export type { ChannelScreen };
