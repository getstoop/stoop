import type { QueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import type { Page } from "../core/channelTimeline";
import {
  initialTimeline,
  type TimelineAction,
  type Timeline as TimelineState,
  timelineReducer,
} from "../core/timelineState";
import type { ListMessagesResponse } from "../gen/stoop/chat/v1/chat_pb";
import type { Message } from "../gen/stoop/chat/v1/message_pb";
import type { ServerEvent } from "../gen/stoop/realtime/v1/realtime_pb";

// The timeline shows one contiguous *window* of a channel's messages: the
// flat ["messages", channelId] array (a thread's: ["messages", channelId,
// rootId], see Timeline). Usually it's the newest page and grows
// as history is paged in above and realtime appends below ("live"). Jumping
// to a message that isn't loaded replaces the window with one centred on it;
// from there the reader pages forward until the window reaches the newest
// message again. Whichever end is being extended, the far end is pruned
// past WINDOW_CAP so the DOM stays bounded — the cap is what makes this
// tolerable without virtualization (STOOP-58).
//
// What each answer and event does to a window is the shared timeline
// reducer's (core/timelineState). Its state sits here, beside the window,
// whose messages stay in the query cache: other writers change them there
// (a pin, a thread's summary, a reaction before the server answers), so
// each step reads them from the cache and writes back what changed. The
// requests themselves are in timelineLoads.ts.

export const HISTORY_PAGE = 50;
export const WINDOW_CAP = 300;

// A timeline is a channel's messages, or one thread's replies inside it
// (rootId set). Each has its own window, cached under its own key; the
// thread's sits under the channel's, so a write to every window of a
// channel is one prefix (["messages", channelId]).
export interface Timeline {
  channelId: string;
  rootId?: string;
}

export const timelineKey = (t: Timeline) =>
  t.rootId ? ["messages", t.channelId, t.rootId] : ["messages", t.channelId];

// The history store's key: a channel's id, or channel/root for a thread.
export const timelineId = (t: Timeline) =>
  t.rootId ? `${t.channelId}/${t.rootId}` : t.channelId;

// Whether a key under ["messages"] is a timeline's window, rather than a
// thread's root or a linked message (["messages", channelId, id, "root"]).
export const isTimelineKey = (key: readonly unknown[]) =>
  key[0] === "messages" && (key.length === 2 || key.length === 3);

export interface ChannelHistory {
  // The server said there may be messages beyond the window's edges.
  hasOlder: boolean;
  hasNewer: boolean;
  // A page (or jump) in flight, so the sentinels don't double-fire.
  loading: boolean;
  // Messages that arrived while the window wasn't live; shown on the
  // "Jump to latest" pill, fetched when it's pressed.
  pendingNewer: number;
  // After a jump replaces the window: where the timeline should land once
  // it has rendered. Cleared by the timeline via landed().
  landOn?: { id: string } | "bottom";
  // The window was fetched around a reply that shows only in its thread:
  // the server centred it on this root, the thread to open.
  aroundThread?: string;
}

export type WindowState = TimelineState<undefined>;
type Where = Pick<ChannelHistory, "landOn" | "aroundThread">;

interface HistoryState {
  // What the timeline reads, by timelineId: undefined until a window is in.
  channels: Record<string, ChannelHistory>;
  // The reducer's state, by timelineId.
  windows: Record<string, WindowState>;
}

export const useHistoryStore = create<HistoryState>(() => ({
  channels: {},
  windows: {},
}));

export const isLive = (h: ChannelHistory | undefined) => !h?.hasNewer;

// A timeline's reducer state, with the messages its window holds now.
export function windowOf(queryClient: QueryClient, t: Timeline): WindowState {
  const kept: WindowState =
    useHistoryStore.getState().windows[timelineId(t)] ?? initialTimeline;
  const messages = queryClient.getQueryData<Message[]>(timelineKey(t));
  const { shown } = kept;
  if (messages === undefined)
    return shown.state === "ready"
      ? { ...kept, shown: { state: "loading" } }
      : kept;
  if (shown.state === "ready") {
    if (shown.page.messages === messages) return kept;
    return { ...kept, shown: { ...shown, page: { ...shown.page, messages } } };
  }
  // Put in the cache by something else first.
  return {
    ...kept,
    shown: {
      state: "ready",
      channelId: t.channelId,
      rootId: t.rootId,
      page: { messages, hasOlder: false, hasNewer: false },
      header: undefined,
      newAfter: null,
      loadingOlder: false,
      loadingNewer: false,
      pendingNewer: 0,
    },
  };
}

// Runs one action through the reducer and keeps the result. Its messages
// go to the cache unless the caller is a queryFn, which returns them. A
// timeline that is gone leaves the cache.
export function step(
  queryClient: QueryClient,
  t: Timeline,
  action: TimelineAction<undefined>,
  write = true,
): { before: WindowState; after: WindowState } {
  const before = windowOf(queryClient, t);
  const after = timelineReducer(before, action);
  const id = timelineId(t);
  if (after.shown.state === "gone") {
    forget(t);
    queryClient.removeQueries({ queryKey: timelineKey(t), exact: true });
    return { before, after };
  }
  useHistoryStore.setState((s) => ({
    windows: { ...s.windows, [id]: after },
    channels: withHistory(s.channels, id, after),
  }));
  const { shown } = after;
  if (
    write &&
    shown.state === "ready" &&
    (before.shown.state !== "ready" ||
      shown.page.messages !== before.shown.page.messages)
  ) {
    queryClient.setQueryData<Message[]>(timelineKey(t), shown.page.messages);
  }
  return { before, after };
}

// Whether a request was still counted when its answer came.
export const wasOut = (state: WindowState, id: number) =>
  state.requests.some((out) => out.id === id);

export function pageOf(res: ListMessagesResponse): Page {
  return {
    messages: res.messages,
    hasOlder: res.hasOlder,
    hasNewer: res.hasNewer,
  };
}

// Sets where the timeline lands, and the thread a fetch around a reply
// named.
export function setWhere(t: Timeline, where: Where) {
  useHistoryStore.setState((s) => {
    const id = timelineId(t);
    const current = s.channels[id];
    if (!current) return s;
    return { channels: { ...s.channels, [id]: { ...current, ...where } } };
  });
}

// The timeline scrolled to landOn.
export const landed = (t: Timeline) => setWhere(t, { landOn: undefined });

// The thread a fetch around a reply named, once: reading it clears it, so
// a later jump in the same window can't open it again.
export function takeAroundThread(t: Timeline): string | undefined {
  const thread =
    useHistoryStore.getState().channels[timelineId(t)]?.aroundThread;
  if (thread) setWhere(t, { aroundThread: undefined });
  return thread;
}

// A realtime event, for every timeline of its channel: what each window
// holds, and the requests out that will replay it.
export function applyTimelineEvent(
  queryClient: QueryClient,
  event: ServerEvent,
) {
  const channelId = channelOf(event);
  if (!channelId) return;
  for (const t of timelinesOf(queryClient, channelId)) {
    step(queryClient, t, { type: "event", event });
  }
}

// The socket is back: a page asked for before now may have missed what
// changed while it was down.
export function reconnected() {
  useHistoryStore.setState((s) => {
    const windows: Record<string, WindowState> = {};
    for (const [id, state] of Object.entries(s.windows)) {
      windows[id] = timelineReducer(state, { type: "reconnected" });
    }
    return { windows };
  });
}

function forget(t: Timeline) {
  const id = timelineId(t);
  useHistoryStore.setState((s) => {
    const { [id]: _window, ...windows } = s.windows;
    const { [id]: _history, ...channels } = s.channels;
    return { windows, channels };
  });
}

// What the timeline reads, kept as the same object while nothing in it
// changed so a row isn't drawn again for an event elsewhere.
function withHistory(
  channels: Record<string, ChannelHistory>,
  id: string,
  state: WindowState,
): Record<string, ChannelHistory> {
  const current = channels[id];
  const { shown } = state;
  if (shown.state !== "ready") {
    if (!current) return channels;
    const { [id]: _gone, ...rest } = channels;
    return rest;
  }
  const next: ChannelHistory = {
    hasOlder: shown.page.hasOlder,
    hasNewer: !!shown.page.hasNewer,
    loading:
      shown.loadingOlder ||
      shown.loadingNewer ||
      state.requests.some((out) => out.kind === "open"),
    pendingNewer: shown.pendingNewer,
    landOn: current?.landOn,
    aroundThread: current?.aroundThread,
  };
  if (
    current &&
    current.hasOlder === next.hasOlder &&
    current.hasNewer === next.hasNewer &&
    current.loading === next.loading &&
    current.pendingNewer === next.pendingNewer
  )
    return channels;
  return { ...channels, [id]: next };
}

function channelOf(event: ServerEvent): string | undefined {
  const payload = event.payload;
  switch (payload.case) {
    case "messageCreated":
    case "messageUpdated":
    case "messageDeleted":
    case "reactionsChanged":
    case "channelDeleted":
      return payload.value.channelId;
    default:
      return undefined;
  }
}

// The channel's timelines: its own and its threads', those with a window
// in the cache and those whose first load is still out.
function timelinesOf(queryClient: QueryClient, channelId: string): Timeline[] {
  const found = new Map<string, Timeline>();
  for (const query of queryClient
    .getQueryCache()
    .findAll({ queryKey: ["messages", channelId] })) {
    if (!isTimelineKey(query.queryKey)) continue;
    const rootId = query.queryKey[2] as string | undefined;
    const t = { channelId, rootId };
    found.set(timelineId(t), t);
  }
  for (const id of Object.keys(useHistoryStore.getState().windows)) {
    const [owner, rootId] = id.split("/");
    if (owner === channelId) found.set(id, { channelId, rootId });
  }
  return [...found.values()];
}
