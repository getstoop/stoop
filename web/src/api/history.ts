import type { QueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import type { ListMessagesResponse } from "../gen/stoop/chat/v1/chat_pb";
import type { Message } from "../gen/stoop/chat/v1/message_pb";
import { chatClient } from "./clients";

// The timeline shows one contiguous *window* of a channel's messages: the
// flat ["messages", channelId] array (a thread's: ["messages", channelId,
// rootId], see Timeline). Usually it's the newest page and grows
// as history is paged in above and realtime appends below ("live"). Jumping
// to a message that isn't loaded replaces the window with one centred on it;
// from there the reader pages forward until the window reaches the newest
// message again. Whichever end is being extended, the far end is pruned
// past WINDOW_CAP so the DOM stays bounded — the cap is what makes this
// tolerable without virtualization (STOOP-58).

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

export interface ChannelHistory {
  // The server said there may be messages beyond the window's edges.
  hasOlder: boolean;
  hasNewer: boolean;
  // In-flight page (or jump), so the sentinels don't double-fire.
  loading: boolean;
  // Messages that arrived while the window wasn't live; shown on the
  // "Jump to latest" pill, fetched when it's pressed.
  pendingNewer: number;
  // After a jump replaces the window: where the timeline should land once
  // it has rendered. Cleared by the timeline via landed().
  landOn?: { id: string } | "bottom";
}

const IDLE: ChannelHistory = {
  hasOlder: false,
  hasNewer: false,
  loading: false,
  pendingNewer: 0,
};

interface HistoryState {
  // By timelineId.
  channels: Record<string, ChannelHistory>;
  // The base query delivered a fresh window; take the server's edge hints.
  seed: (t: Timeline, res: ListMessagesResponse) => void;
  // Prepend the page before the window's oldest message.
  loadOlder: (queryClient: QueryClient, t: Timeline) => Promise<number>;
  // Append the page after the window's newest message.
  loadNewer: (queryClient: QueryClient, t: Timeline) => Promise<number>;
  // Replace the window with one centred on messageId; false if it isn't
  // in the timeline (deleted, or a bogus link).
  jumpTo: (
    queryClient: QueryClient,
    t: Timeline,
    messageId: string,
  ) => Promise<boolean>;
  // Replace a non-live window with the newest page.
  jumpToLatest: (queryClient: QueryClient, t: Timeline) => Promise<void>;
  // A message was created while the window isn't live.
  noteArrival: (t: Timeline) => void;
  // The timeline scrolled to landOn.
  landed: (t: Timeline) => void;
}

export const isLive = (h: ChannelHistory | undefined) => !h?.hasNewer;

// The listMessages request for a timeline, before its paging fields.
const scope = (t: Timeline) => ({
  channelId: t.channelId,
  threadId: t.rootId ?? "",
});

export const useHistoryStore = create<HistoryState>((set, get) => {
  const patch = (t: Timeline, p: Partial<ChannelHistory>) =>
    set((s) => ({
      channels: {
        ...s.channels,
        [timelineId(t)]: { ...(s.channels[timelineId(t)] ?? IDLE), ...p },
      },
    }));
  const fromResponse = (res: ListMessagesResponse): ChannelHistory => ({
    hasOlder: res.hasOlder,
    hasNewer: res.hasNewer,
    loading: false,
    pendingNewer: 0,
  });
  // Runs one page fetch, guarded against overlap; returns the page or null.
  const page = async (
    t: Timeline,
    fetch: () => Promise<ListMessagesResponse>,
  ) => {
    const cur = get().channels[timelineId(t)] ?? IDLE;
    if (cur.loading) return null;
    patch(t, { loading: true });
    try {
      return await fetch();
    } catch {
      return null;
    } finally {
      patch(t, { loading: false });
    }
  };

  return {
    channels: {},
    seed: (t, res) =>
      set((s) => ({
        channels: { ...s.channels, [timelineId(t)]: fromResponse(res) },
      })),

    loadOlder: async (queryClient, t) => {
      const cur = get().channels[timelineId(t)] ?? IDLE;
      const have = queryClient.getQueryData<Message[]>(timelineKey(t));
      if (!cur.hasOlder || !have?.length) return 0;
      const res = await page(t, () =>
        chatClient.listMessages({
          ...scope(t),
          beforeId: have[0].id,
          limit: HISTORY_PAGE,
        }),
      );
      if (!res) return 0;
      let pruned = false;
      queryClient.setQueryData<Message[]>(timelineKey(t), (old) => {
        if (!old) return old;
        const seen = new Set(old.map((m) => m.id));
        let next = [...res.messages.filter((m) => !seen.has(m.id)), ...old];
        if (next.length > WINDOW_CAP) {
          next = next.slice(0, WINDOW_CAP);
          pruned = true;
        }
        return next;
      });
      patch(t, {
        hasOlder: res.hasOlder,
        // Dropping the newest rows means the window no longer ends at the
        // newest message; arrivals count on the pill from here.
        ...(pruned ? { hasNewer: true } : {}),
      });
      return res.messages.length;
    },

    loadNewer: async (queryClient, t) => {
      const cur = get().channels[timelineId(t)] ?? IDLE;
      const have = queryClient.getQueryData<Message[]>(timelineKey(t));
      if (!cur.hasNewer || !have?.length) return 0;
      const res = await page(t, () =>
        chatClient.listMessages({
          ...scope(t),
          afterId: have[have.length - 1].id,
          limit: HISTORY_PAGE,
        }),
      );
      if (!res) return 0;
      let pruned = false;
      queryClient.setQueryData<Message[]>(timelineKey(t), (old) => {
        if (!old) return old;
        const seen = new Set(old.map((m) => m.id));
        let next = [...old, ...res.messages.filter((m) => !seen.has(m.id))];
        if (next.length > WINDOW_CAP) {
          next = next.slice(next.length - WINDOW_CAP);
          pruned = true;
        }
        return next;
      });
      patch(t, {
        hasNewer: res.hasNewer,
        ...(pruned ? { hasOlder: true } : {}),
        // Back at the newest message: everything that arrived is now loaded.
        ...(res.hasNewer ? {} : { pendingNewer: 0 }),
      });
      return res.messages.length;
    },

    jumpTo: async (queryClient, t, messageId) => {
      const res = await page(t, () =>
        chatClient.listMessages({
          ...scope(t),
          aroundId: messageId,
          limit: HISTORY_PAGE,
        }),
      );
      if (!res) return false;
      queryClient.setQueryData<Message[]>(timelineKey(t), res.messages);
      get().seed(t, res);
      patch(t, { landOn: { id: messageId } });
      return true;
    },

    jumpToLatest: async (queryClient, t) => {
      if (isLive(get().channels[timelineId(t)])) return;
      const res = await page(t, () =>
        chatClient.listMessages({ ...scope(t), limit: HISTORY_PAGE }),
      );
      if (!res) return;
      queryClient.setQueryData<Message[]>(timelineKey(t), res.messages);
      get().seed(t, res);
      patch(t, { landOn: "bottom" });
    },

    landed: (t) => patch(t, { landOn: undefined }),

    noteArrival: (t) =>
      set((s) => {
        const cur = s.channels[timelineId(t)];
        if (!cur?.hasNewer) return s;
        return {
          channels: {
            ...s.channels,
            [timelineId(t)]: { ...cur, pendingNewer: cur.pendingNewer + 1 },
          },
        };
      }),
  };
});
