// Kept for the mobile app, which imports it through @stoop/core; the web
// app no longer uses it (it runs core/channelLog, proposals/channel-log.md).
import type { ServerEvent } from "../gen/stoop/realtime/v1/realtime_pb";
import { type Page, withNewestPage } from "./channelTimeline";
import { type Header, type Held, withTimelineEvent } from "./timelineEvents";
import {
  isPage,
  notPaging,
  type PageKind,
  pagedIn,
  startedPage,
  without,
} from "./timelinePaging";

export { newerAfter, olderBefore } from "./timelinePaging";

// A channel's timeline as a reducer: the window of messages shown, the
// requests out and what each has kept, and what each answer and realtime
// event does to them. Fetching stays in the app: it dispatches a request's
// start, then its answer or its failure, under an id of its own choosing.
// The header is a slice beside the window (timelineEvents): H is
// ChannelHeader for a timeline that carries one, undefined for one that
// gets it elsewhere. Paging is timelinePaging's.

export type Shown<H extends Header = Header> =
  | { state: "loading" }
  | (Held<H> & {
      state: "ready";
      // The read marker as it was on opening, so the "New" line stays put
      // as the marker moves; null for no "New" line.
      newAfter: string | null;
      loadingOlder: boolean;
      loadingNewer: boolean;
      // Messages that arrived beyond a window that doesn't reach the
      // newest one (page.hasNewer): counted, not shown.
      pendingNewer: number;
    })
  // The reader's sign-in has ended.
  | { state: "ended" }
  | { state: "gone" }
  | { state: "failed" };

export type Ready<H extends Header> = Shown<H> & { state: "ready" };

// Open loads a new window: the newest page, or one around a message. A
// catch-up loads it again after a reconnect, back to the oldest message
// held; a refresh does the same when nothing was missed (how old messages
// read has changed). Older and newer are the pages above and below what
// is held.
export type RequestKind = "open" | "catchUp" | "refresh" | PageKind;

export type Request = {
  id: number;
  kind: RequestKind;
  // The reconnects before it started.
  since: number;
  // An open's channel, when the caller names it.
  channelId?: string;
  // The events that arrived while it was out.
  kept: ServerEvent[];
};

export type Timeline<H extends Header = Header> = {
  shown: Shown<H>;
  requests: Request[];
  reconnects: number;
};

export type TimelineAction<H extends Header = Header> =
  // An open may name its channel: one that fails over a window of the
  // same channel (a jump) keeps that window.
  | { type: "started"; id: number; kind: RequestKind; channelId?: string }
  | {
      type: "loaded";
      id: number;
      channelId: string;
      // A thread's timeline: its root.
      rootId?: string;
      page: Page;
      header: H;
      newAfter: string | null;
    }
  // With a cap, the window keeps at most that many messages.
  | { type: "paged"; id: number; page: Page; cap?: number }
  | { type: "failed"; id: number; outcome: "ended" | "gone" | "failed" }
  | { type: "event"; event: ServerEvent }
  // The socket is back, for an app whose catch-up starts apart from it:
  // a page asked for before may predate what was missed. A catch-up's
  // start counts as one too.
  | { type: "reconnected" }
  // The reader asked to try again after a failed open.
  | { type: "retried" };

export const initialTimeline: Timeline<never> = {
  shown: { state: "loading" },
  requests: [],
  reconnects: 0,
};

// A request's answer may predate whatever arrived while it was out, so
// those events are replayed over it. Only the latest load counts, and an
// open puts every request before it out of date. A reconnect drops a page
// asked for before it, since the page may predate what was missed and the
// catch-up may have replaced what is held.
export function timelineReducer<H extends Header>(
  state: Timeline<H>,
  action: TimelineAction<H>,
): Timeline<H> {
  switch (action.type) {
    case "started":
      return started(state, action.id, action.kind, action.channelId);
    case "loaded": {
      const request = state.requests.find((out) => out.id === action.id);
      if (!request || isPage(request.kind)) return state;
      const next: Ready<H> = {
        state: "ready",
        channelId: action.channelId,
        rootId: action.rootId,
        page: action.page,
        header: action.header,
        newAfter: action.newAfter,
        loadingOlder: false,
        loadingNewer: false,
        pendingNewer: 0,
      };
      if (request.kind !== "open")
        return settled(state, request, caughtUp(state.shown, next));
      // A new window: a page still out was asked for beside another.
      const opened = settled(state, request, next);
      return {
        ...opened,
        requests: opened.requests.filter((out) => !isPage(out.kind)),
      };
    }
    case "failed": {
      const request = state.requests.find((out) => out.id === action.id);
      if (!request) return state;
      if (isPage(request.kind)) {
        return { ...without(state, request), shown: notPaging(state.shown) };
      }
      // A load of what is on screen that can't reach the server keeps it,
      // and it has had every event already.
      const same =
        request.kind !== "open" ||
        (state.shown.state === "ready" &&
          request.channelId === state.shown.channelId);
      if (state.shown.state === "ready" && action.outcome === "failed" && same)
        return without(state, request);
      return settled(state, request, { state: action.outcome });
    }
    case "paged": {
      const request = state.requests.find((out) => out.id === action.id);
      if (!request || !isPage(request.kind)) return state;
      return pagedIn(state, request, action.page, action.cap);
    }
    case "event":
      return withLiveEvent(state, action.event);
    case "reconnected":
      return { ...state, reconnects: state.reconnects + 1 };
    case "retried":
      return state.shown.state === "failed"
        ? { ...state, shown: { state: "loading" } }
        : state;
  }
}

// What a socket's Ready asks for: a catch-up of what is shown, or the open
// started again, since a load still out may have read the server before
// the socket was back.
export function reconnectLoad<H extends Header>(
  state: Timeline<H>,
): "open" | "catchUp" | null {
  switch (state.shown.state) {
    case "ready":
      return "catchUp";
    case "loading":
    case "failed":
      return "open";
    default:
      return null;
  }
}

// The oldest message held, the id a catch-up loads back to.
export function heldBack<H extends Header>(state: Timeline<H>): string {
  return state.shown.state === "ready"
    ? (state.shown.page.messages[0]?.id ?? "")
    : "";
}

function started<H extends Header>(
  state: Timeline<H>,
  id: number,
  kind: RequestKind,
  channelId?: string,
): Timeline<H> {
  if (isPage(kind)) return startedPage(state, id, kind);
  // A new window on its way will be fresher than a refresh, unless it
  // was asked for before a reconnect.
  const opening = state.requests.some(
    (out) => out.kind === "open" && out.since === state.reconnects,
  );
  if (kind === "refresh" && opening) return state;
  // A load puts any other load out of date; an open, everything out.
  const reconnects = state.reconnects + (kind === "catchUp" ? 1 : 0);
  const request: Request = { id, kind, since: reconnects, kept: [] };
  if (kind === "open") {
    if (channelId !== undefined) request.channelId = channelId;
    return {
      ...state,
      reconnects,
      shown: notPaging(state.shown),
      requests: [request],
    };
  }
  return {
    ...state,
    reconnects,
    requests: [...state.requests.filter((out) => isPage(out.kind)), request],
  };
}

// After a reconnect, the newest page joins the history already held; the
// header's facts may have changed too.
function caughtUp<H extends Header>(
  current: Shown<H>,
  next: Ready<H>,
): Shown<H> {
  if (current.state !== "ready") return next;
  const page = withNewestPage(current.page, next.page);
  return {
    ...current,
    page,
    header: next.header,
    // At the newest message: everything counted is now shown.
    pendingNewer: page.hasNewer ? current.pendingNewer : 0,
  };
}

// A load's answer, or its failure, with what it kept replayed over it.
function settled<H extends Header>(
  state: Timeline<H>,
  request: Request,
  shown: Shown<H>,
): Timeline<H> {
  return {
    ...without(state, request),
    shown: request.kept.reduce(
      (current, event) => withEvent(current, event, false),
      shown,
    ),
  };
}

function withLiveEvent<H extends Header>(
  state: Timeline<H>,
  event: ServerEvent,
): Timeline<H> {
  const requests = state.requests.map((out) => ({
    ...out,
    kept: [...out.kept, event],
  }));
  const shown = withEvent(state.shown, event, true);
  if (shown.state === "gone" && state.shown.state === "ready") {
    // Nothing a load still out brings back can undo it.
    return {
      ...state,
      shown,
      requests: requests.filter((out) => isPage(out.kind)),
    };
  }
  return { ...state, requests, shown };
}

// Losing the channel ends what is shown. A replay is live false. A new
// message beyond the window's newer edge is counted, not shown.
function withEvent<H extends Header>(
  shown: Shown<H>,
  event: ServerEvent,
  live: boolean,
): Shown<H> {
  if (shown.state !== "ready") return shown;
  const next = withTimelineEvent(shown, event, live);
  if (!next) return { state: "gone" };
  const arrived =
    event.payload.case === "messageCreated" &&
    next.page.messages !== shown.page.messages;
  if (arrived && shown.page.hasNewer)
    return { ...shown, pendingNewer: shown.pendingNewer + 1 };
  return next;
}
