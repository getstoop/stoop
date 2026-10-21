import type { Channel } from "../gen/stoop/chat/v1/channel_pb";
import type { Space } from "../gen/stoop/chat/v1/space_pb";
import type { ServerEvent } from "../gen/stoop/realtime/v1/realtime_pb";
import {
  losesChannel,
  type Page,
  withChannelEvent,
  withNewestPage,
} from "./channelTimeline";

// A channel's timeline as a reducer: what is shown, the requests out and
// what each has kept, and what each answer and realtime event does to
// them. Fetching stays in the app: it dispatches a request's start, then
// its answer or its failure, under an id of its own choosing.

// What opening a channel loads: its newest page, the channel and its space
// for the title, how many can read it (the space's members, or a private
// channel's), and who is reading.
export type ChannelView = Page & {
  space: Space;
  channel: Channel;
  memberCount: number;
  myUserId: string;
};

export type Shown =
  | { state: "loading" }
  | {
      state: "ready";
      view: ChannelView;
      // The read marker as it was on opening, so the "New" line stays put
      // as the marker moves.
      newAfter: string;
      loadingOlder: boolean;
    }
  // The reader's sign-in has ended.
  | { state: "ended" }
  | { state: "gone" }
  | { state: "failed" };

type Ready = Shown & { state: "ready" };

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

export type Timeline = {
  shown: Shown;
  requests: Request[];
  reconnects: number;
};

export type TimelineAction =
  | { type: "started"; id: number; kind: RequestKind }
  | { type: "loaded"; id: number; view: ChannelView }
  | { type: "paged"; id: number; page: Page }
  | { type: "failed"; id: number; outcome: "ended" | "gone" | "failed" }
  | { type: "event"; event: ServerEvent }
  // The reader asked to try again after a failed open.
  | { type: "retried" };

export const initialTimeline: Timeline = {
  shown: { state: "loading" },
  requests: [],
  reconnects: 0,
};

// A request's answer may predate whatever arrived while it was out, so
// those events are replayed over it. Only the latest open or catch-up
// counts, and a catch-up is a reconnect: an older page asked for before
// one is dropped, since it may predate what was missed and the catch-up
// may have replaced what is held.
export function timelineReducer(
  state: Timeline,
  action: TimelineAction,
): Timeline {
  switch (action.type) {
    case "started":
      return started(state, action.id, action.kind);
    case "loaded": {
      const request = state.requests.find((out) => out.id === action.id);
      if (!request || request.kind === "older") return state;
      const next: Shown = {
        state: "ready",
        view: action.view,
        newAfter: action.view.channel.lastReadMessageId,
        loadingOlder: false,
      };
      const shown =
        request.kind === "catchUp" ? caughtUp(state.shown, next) : next;
      return settled(state, request, shown);
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
      return withEvent(state, action.event);
    case "retried":
      return state.shown.state === "failed"
        ? { ...state, shown: { state: "loading" } }
        : state;
  }
}

// What a socket's Ready asks for: a catch-up of what is shown, or the open
// started again, since a load still out may have read the server before
// the socket was back.
export function reconnectLoad(state: Timeline): "open" | "catchUp" | null {
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
export function heldBack(state: Timeline): string {
  return state.shown.state === "ready"
    ? (state.shown.view.messages[0]?.id ?? "")
    : "";
}

// The id to page back from, or null when there is no older page to ask
// for: nothing above, or one already on its way.
export function olderBefore(state: Timeline): string | null {
  const { shown } = state;
  if (shown.state !== "ready" || shown.loadingOlder || !shown.view.hasOlder)
    return null;
  return shown.view.messages[0]?.id ?? null;
}

function started(state: Timeline, id: number, kind: RequestKind): Timeline {
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
  // A load starting puts any other load out of date.
  const reconnects = state.reconnects + (kind === "catchUp" ? 1 : 0);
  return {
    ...state,
    reconnects,
    requests: [
      ...state.requests.filter((out) => out.kind === "older"),
      { id, kind, since: reconnects, kept: [] },
    ],
  };
}

// After a reconnect, the newest page joins the history already held; the
// header's facts may have changed too.
function caughtUp(current: Shown, next: Ready): Shown {
  if (current.state !== "ready") return next;
  const merged = withNewestPage(current.view, next.view);
  return { ...current, view: { ...next.view, ...merged } };
}

// A load's answer, or its failure, with what it kept replayed over it.
function settled(state: Timeline, request: Request, shown: Shown): Timeline {
  return {
    ...without(state, request),
    shown: request.kept.reduce(replayed, shown),
  };
}

function paged(state: Timeline, id: number, page: Page): Timeline {
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
  const channelId = shown.view.channel.id;
  const changed = request.kept.reduce(
    (list, event) =>
      event.payload.case === "messageCreated"
        ? list
        : withChannelEvent(list, event, channelId),
    page.messages,
  );
  const held = shown.view.messages;
  const above = changed.filter(
    (message) => !held.some((cached) => cached.id === message.id),
  );
  return {
    ...rest,
    shown: {
      ...shown,
      loadingOlder: false,
      view: {
        ...shown.view,
        messages: [...above, ...held],
        hasOlder: page.hasOlder,
      },
    },
  };
}

function withEvent(state: Timeline, event: ServerEvent): Timeline {
  const requests = state.requests.map((out) => ({
    ...out,
    kept: [...out.kept, event],
  }));
  const { shown } = state;
  if (shown.state !== "ready") return { ...state, requests };
  const { space, channel, myUserId } = shown.view;
  if (losesChannel(event, space.id, channel.id, myUserId)) {
    // Nothing a load still out brings back can undo it.
    return {
      ...state,
      shown: { state: "gone" },
      requests: requests.filter((out) => out.kind === "older"),
    };
  }
  return { ...state, requests, shown: withShownEvent(shown, event, true) };
}

function without(state: Timeline, request: Request): Timeline {
  return {
    ...state,
    requests: state.requests.filter((out) => out !== request),
  };
}

function notPaging(shown: Shown): Shown {
  return shown.state === "ready" ? { ...shown, loadingOlder: false } : shown;
}

function replayed(shown: Shown, event: ServerEvent): Shown {
  return withShownEvent(shown, event, false);
}

// What a realtime event does to what is shown: losing the channel ends
// it, a rename or a member coming or going changes the title, and the
// rest is the messages' (withChannelEvent). A replay (live false) leaves
// the member count alone: the answer it is replayed over may have counted
// them already, and unlike the rest a count isn't safe to apply twice.
function withShownEvent(
  shown: Shown,
  event: ServerEvent,
  live: boolean,
): Shown {
  if (shown.state !== "ready") return shown;
  const { view } = shown;
  if (losesChannel(event, view.space.id, view.channel.id, view.myUserId))
    return { state: "gone" };
  const payload = event.payload;
  switch (payload.case) {
    case "channelUpdated": {
      if (payload.value.id !== view.channel.id) return shown;
      const { name, private: closed, topic, postPolicy } = payload.value;
      return {
        ...shown,
        view: {
          ...view,
          channel: {
            ...view.channel,
            name,
            private: closed,
            topic,
            postPolicy,
          },
        },
      };
    }
    case "spaceUpdated":
      if (!payload.value.space || payload.value.space.id !== view.space.id)
        return shown;
      return { ...shown, view: { ...view, space: payload.value.space } };
    case "memberJoined":
    case "memberRemoved":
      // A private channel's members join and leave it on their own.
      if (
        !live ||
        view.channel.private ||
        payload.value.spaceId !== view.space.id
      )
        return shown;
      return withMemberCount(shown, payload.case === "memberJoined" ? 1 : -1);
    case "channelMemberJoined":
    case "channelMemberLeft":
      if (
        !live ||
        !view.channel.private ||
        payload.value.channelId !== view.channel.id
      )
        return shown;
      return withMemberCount(
        shown,
        payload.case === "channelMemberJoined" ? 1 : -1,
      );
  }
  const messages = withChannelEvent(view.messages, event, view.channel.id);
  return messages === view.messages
    ? shown
    : { ...shown, view: { ...view, messages } };
}

function withMemberCount(shown: Ready, change: number): Shown {
  return {
    ...shown,
    view: {
      ...shown.view,
      memberCount: Math.max(0, shown.view.memberCount + change),
    },
  };
}
