import type { ServerEvent } from "../gen/stoop/realtime/v1/realtime_pb";
import { type Page, withChannelEvent, withNewestPage } from "./channelTimeline";
import { type Header, type Held, withTimelineEvent } from "./timelineEvents";

// A channel's timeline as a reducer: the window of messages shown, the
// requests out and what each has kept, and what each answer and realtime
// event does to them. Fetching stays in the app: it dispatches a request's
// start, then its answer or its failure, under an id of its own choosing.
// The header is a slice beside the window (timelineEvents): H is
// ChannelHeader for a timeline that carries one, undefined for one that
// gets it elsewhere.

export type Shown<H extends Header = Header> =
  | { state: "loading" }
  | (Held<H> & {
      state: "ready";
      // The read marker as it was on opening, so the "New" line stays put
      // as the marker moves; null for no "New" line.
      newAfter: string | null;
      loadingOlder: boolean;
    })
  // The reader's sign-in has ended.
  | { state: "ended" }
  | { state: "gone" }
  | { state: "failed" };

type Ready<H extends Header> = Shown<H> & { state: "ready" };

// Open loads the channel; a catch-up loads it again after a reconnect,
// back to the oldest message held; older is the page above what is held.
export type RequestKind = "open" | "catchUp" | "older";

type Request = {
  id: number;
  kind: RequestKind;
  // The reconnects before it started.
  since: number;
  // The events that arrived while it was out.
  kept: ServerEvent[];
};

export type Timeline<H extends Header = Header> = {
  shown: Shown<H>;
  requests: Request[];
  reconnects: number;
};

export type TimelineAction<H extends Header = Header> =
  | { type: "started"; id: number; kind: RequestKind }
  | {
      type: "loaded";
      id: number;
      channelId: string;
      page: Page;
      header: H;
      newAfter: string | null;
    }
  | { type: "paged"; id: number; page: Page }
  | { type: "failed"; id: number; outcome: "ended" | "gone" | "failed" }
  | { type: "event"; event: ServerEvent }
  // The reader asked to try again after a failed open.
  | { type: "retried" };

export const initialTimeline: Timeline<never> = {
  shown: { state: "loading" },
  requests: [],
  reconnects: 0,
};

// A request's answer may predate whatever arrived while it was out, so
// those events are replayed over it. Only the latest open or catch-up
// counts, and an open puts every request before it out of date. A catch-up
// is a reconnect: an older page asked for before one is dropped, since it
// may predate what was missed and the catch-up may have replaced what is
// held.
export function timelineReducer<H extends Header>(
  state: Timeline<H>,
  action: TimelineAction<H>,
): Timeline<H> {
  switch (action.type) {
    case "started":
      return started(state, action.id, action.kind);
    case "loaded": {
      const request = state.requests.find((out) => out.id === action.id);
      if (!request || request.kind === "older") return state;
      const next: Ready<H> = {
        state: "ready",
        channelId: action.channelId,
        page: action.page,
        header: action.header,
        newAfter: action.newAfter,
        loadingOlder: false,
      };
      if (request.kind === "catchUp")
        return settled(state, request, caughtUp(state.shown, next));
      // A new window: an older page still out was asked for above another.
      const opened = settled(state, request, next);
      return {
        ...opened,
        requests: opened.requests.filter((out) => out.kind !== "older"),
      };
    }
    case "failed": {
      const request = state.requests.find((out) => out.id === action.id);
      if (!request) return state;
      if (request.kind === "older") {
        return { ...without(state, request), shown: notPaging(state.shown) };
      }
      // A reconnect that can't load keeps what is on screen.
      const keeps =
        request.kind === "catchUp" &&
        state.shown.state === "ready" &&
        action.outcome === "failed";
      return settled(
        state,
        request,
        keeps ? state.shown : { state: action.outcome },
      );
    }
    case "paged":
      return paged(state, action.id, action.page);
    case "event":
      return withLiveEvent(state, action.event);
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

// The id to page back from, or null when there is no older page to ask
// for: nothing above, or one already on its way.
export function olderBefore<H extends Header>(
  state: Timeline<H>,
): string | null {
  const { shown } = state;
  if (shown.state !== "ready" || shown.loadingOlder || !shown.page.hasOlder)
    return null;
  return shown.page.messages[0]?.id ?? null;
}

function started<H extends Header>(
  state: Timeline<H>,
  id: number,
  kind: RequestKind,
): Timeline<H> {
  if (kind === "older") {
    const { shown } = state;
    if (shown.state !== "ready" || olderBefore(state) === null) return state;
    return {
      ...state,
      shown: { ...shown, loadingOlder: true },
      requests: [
        ...state.requests,
        { id, kind, since: state.reconnects, kept: [] },
      ],
    };
  }
  // A catch-up puts any other load out of date; an open, everything out.
  const reconnects = state.reconnects + (kind === "catchUp" ? 1 : 0);
  const kept =
    kind === "catchUp"
      ? state.requests.filter((out) => out.kind === "older")
      : [];
  return {
    ...state,
    reconnects,
    requests: [...kept, { id, kind, since: reconnects, kept: [] }],
  };
}

// After a reconnect, the newest page joins the history already held; the
// header's facts may have changed too.
function caughtUp<H extends Header>(
  current: Shown<H>,
  next: Ready<H>,
): Shown<H> {
  if (current.state !== "ready") return next;
  return {
    ...current,
    page: withNewestPage(current.page, next.page),
    header: next.header,
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

function paged<H extends Header>(
  state: Timeline<H>,
  id: number,
  page: Page,
): Timeline<H> {
  const request = state.requests.find((out) => out.id === id);
  if (!request || request.kind !== "older") return state;
  const rest = without(state, request);
  const { shown } = state;
  if (shown.state !== "ready") return rest;
  if (request.since !== state.reconnects)
    return { ...rest, shown: notPaging(shown) };
  // What changed in the page meanwhile is replayed over it alone: the same
  // events have already been applied to what is held. A message that
  // arrived meanwhile is new, so never the page's, and is already below;
  // the page goes above whatever is held now.
  const changed = request.kept.reduce(
    (list, event) =>
      event.payload.case === "messageCreated"
        ? list
        : withChannelEvent(list, event, shown.channelId),
    page.messages,
  );
  const held = shown.page.messages;
  const above = changed.filter(
    (message) => !held.some((cached) => cached.id === message.id),
  );
  return {
    ...rest,
    shown: {
      ...shown,
      loadingOlder: false,
      page: { messages: [...above, ...held], hasOlder: page.hasOlder },
    },
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
      requests: requests.filter((out) => out.kind === "older"),
    };
  }
  return { ...state, requests, shown };
}

// Losing the channel ends what is shown. A replay is live false.
function withEvent<H extends Header>(
  shown: Shown<H>,
  event: ServerEvent,
  live: boolean,
): Shown<H> {
  if (shown.state !== "ready") return shown;
  return withTimelineEvent(shown, event, live) ?? { state: "gone" };
}

function without<H extends Header>(
  state: Timeline<H>,
  request: Request,
): Timeline<H> {
  return {
    ...state,
    requests: state.requests.filter((out) => out !== request),
  };
}

function notPaging<H extends Header>(shown: Shown<H>): Shown<H> {
  return shown.state === "ready" ? { ...shown, loadingOlder: false } : shown;
}
