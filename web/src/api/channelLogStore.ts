import { create } from "zustand";
import {
  type ChannelLog,
  channelItems,
  emptyLog,
  threadItems,
  type View,
  viewOf,
} from "../core/channelLog";
import type { Message } from "../gen/stoop/chat/v1/message_pb";

// The channel logs web holds (core/channelLog), one per channel on screen,
// and what a list reads from them. The requests that fill them are in
// channelLog.ts; this file is the store, its writes and its hooks.

// A view by name: a channel's timeline, or one thread's replies in it.
export type ViewRef = { channelId: string; rootId?: string };

export type ViewStatus = {
  // A page or a jump is out for the view.
  loading: boolean;
  // After a jump replaced the range: where the list lands once it has
  // rendered, cleared by the list through landed().
  landOn: { id: string } | "bottom" | null;
};

type LogsState = {
  logs: Record<string, ChannelLog>;
  status: Record<string, ViewStatus>;
};

export const useChannelLogStore = create<LogsState>(() => ({
  logs: {},
  status: {},
}));

export const viewKey = (view: ViewRef) =>
  view.rootId ? `${view.channelId}/${view.rootId}` : view.channelId;

// Requests out per view; loading while any is.
const out = new Map<string, number>();

export const logOf = (channelId: string): ChannelLog | undefined =>
  useChannelLogStore.getState().logs[channelId];

// The channel's log, started empty when the channel wasn't held, so events
// about it have somewhere to go while its first page is out.
export function ensureLog(channelId: string): ChannelLog {
  const held = logOf(channelId);
  if (held) return held;
  const started = emptyLog(channelId);
  useChannelLogStore.setState((state) => ({
    logs: { ...state.logs, [channelId]: started },
  }));
  return started;
}

// The log after the change, or undefined when the channel isn't held.
export function updateLog(
  channelId: string,
  change: (log: ChannelLog) => ChannelLog,
): ChannelLog | undefined {
  const { logs } = useChannelLogStore.getState();
  const before = logs[channelId];
  if (!before) return undefined;
  const after = change(before);
  if (after !== before)
    useChannelLogStore.setState({ logs: { ...logs, [channelId]: after } });
  return after;
}

// Forgetting a channel starts a new epoch for it: a request out for the
// old log answers to nobody, even once the channel is opened again.
const epochs = new Map<string, number>();

export const epochOf = (channelId: string): number =>
  epochs.get(channelId) ?? 0;

export function forgetLog(channelId: string) {
  epochs.set(channelId, epochOf(channelId) + 1);
  useChannelLogStore.setState((state) => {
    const { [channelId]: _gone, ...logs } = state.logs;
    const status: Record<string, ViewStatus> = {};
    for (const [key, held] of Object.entries(state.status)) {
      if (key !== channelId && !key.startsWith(`${channelId}/`))
        status[key] = held;
    }
    return { logs, status };
  });
  for (const key of [...out.keys()]) {
    if (key === channelId || key.startsWith(`${channelId}/`)) out.delete(key);
  }
}

// The view's generation now, for a request to answer under; 0 for a view,
// or a channel, not yet held.
export function generationOf(view: ViewRef): number {
  const log = logOf(view.channelId);
  return log ? (viewOf(log, view.rootId)?.generation ?? 0) : 0;
}

export function beganLoading(view: ViewRef) {
  const key = viewKey(view);
  out.set(key, (out.get(key) ?? 0) + 1);
  setStatus(view, { loading: true });
}

export function endedLoading(view: ViewRef) {
  const key = viewKey(view);
  const left = (out.get(key) ?? 1) - 1;
  if (left > 0) out.set(key, left);
  else out.delete(key);
  setStatus(view, { loading: left > 0 });
}

export const setLanding = (view: ViewRef, landOn: ViewStatus["landOn"]) =>
  setStatus(view, { landOn });

// The list scrolled to where the jump asked.
export const landed = (view: ViewRef) => setStatus(view, { landOn: null });

// A view's status lives only while its channel's log does.
function setStatus(view: ViewRef, change: Partial<ViewStatus>) {
  useChannelLogStore.setState((state) => {
    if (!state.logs[view.channelId]) return state;
    const key = viewKey(view);
    const current = state.status[key] ?? { loading: false, landOn: null };
    const next = { ...current, ...change };
    if (next.loading === current.loading && next.landOn === current.landOn)
      return state;
    return { status: { ...state.status, [key]: next } };
  });
}

const NO_ITEMS: Message[] = [];
const IDLE: ViewStatus = { loading: false, landOn: null };

// Each hook selects a value that stays the same object while nothing it
// shows changed (core/channelLog items), so a list redraws only for its
// own rows.
export const useChannelItems = (channelId: string): Message[] =>
  useChannelLogStore((state) => {
    const log = state.logs[channelId];
    return log ? channelItems(log) : NO_ITEMS;
  });

export const useThreadItems = (channelId: string, rootId: string): Message[] =>
  useChannelLogStore((state) => {
    const log = state.logs[channelId];
    return log ? threadItems(log, rootId) : NO_ITEMS;
  });

// The view's range and flags; undefined until the channel, or the
// thread, has been opened.
export const useView = (channelId: string, rootId?: string): View | undefined =>
  useChannelLogStore((state) => {
    const log = state.logs[channelId];
    return log ? viewOf(log, rootId) : undefined;
  });

export const useViewStatus = (view: ViewRef): ViewStatus =>
  useChannelLogStore((state) => state.status[viewKey(view)] ?? IDLE);
