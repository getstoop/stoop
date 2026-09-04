import type { QueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import type { ListMessagesResponse } from "../gen/stoop/chat/v1/chat_pb";
import type { Message } from "../gen/stoop/chat/v1/message_pb";
import { chatClient } from "./clients";

// The timeline shows one contiguous *window* of a channel's messages: the
// flat ["messages", channelId] array. Usually it's the newest page and grows
// as history is paged in above and realtime appends below ("live"). Jumping
// to a message that isn't loaded replaces the window with one centred on it;
// from there the reader pages forward until the window reaches the newest
// message again. Whichever end is being extended, the far end is pruned
// past WINDOW_CAP so the DOM stays bounded — the cap is what makes this
// tolerable without virtualization (STOOP-58).

export const HISTORY_PAGE = 50;
export const WINDOW_CAP = 300;

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
  channels: Record<string, ChannelHistory>;
  // The base query delivered a fresh window; take the server's edge hints.
  seed: (channelId: string, res: ListMessagesResponse) => void;
  // Prepend the page before the window's oldest message.
  loadOlder: (queryClient: QueryClient, channelId: string) => Promise<number>;
  // Append the page after the window's newest message.
  loadNewer: (queryClient: QueryClient, channelId: string) => Promise<number>;
  // Replace the window with one centred on messageId; false if it isn't
  // in the channel (deleted, or a bogus link).
  jumpTo: (
    queryClient: QueryClient,
    channelId: string,
    messageId: string,
  ) => Promise<boolean>;
  // Replace a non-live window with the newest page.
  jumpToLatest: (queryClient: QueryClient, channelId: string) => Promise<void>;
  // A message was created while the window isn't live.
  noteArrival: (channelId: string) => void;
  // The timeline scrolled to landOn.
  landed: (channelId: string) => void;
}

export const isLive = (h: ChannelHistory | undefined) => !h?.hasNewer;

const key = (channelId: string) => ["messages", channelId];

export const useHistoryStore = create<HistoryState>((set, get) => {
  const patch = (channelId: string, p: Partial<ChannelHistory>) =>
    set((s) => ({
      channels: {
        ...s.channels,
        [channelId]: { ...(s.channels[channelId] ?? IDLE), ...p },
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
    channelId: string,
    fetch: () => Promise<ListMessagesResponse>,
  ) => {
    const cur = get().channels[channelId] ?? IDLE;
    if (cur.loading) return null;
    patch(channelId, { loading: true });
    try {
      return await fetch();
    } catch {
      return null;
    } finally {
      patch(channelId, { loading: false });
    }
  };

  return {
    channels: {},
    seed: (channelId, res) =>
      set((s) => ({
        channels: { ...s.channels, [channelId]: fromResponse(res) },
      })),

    loadOlder: async (queryClient, channelId) => {
      const cur = get().channels[channelId] ?? IDLE;
      const have = queryClient.getQueryData<Message[]>(key(channelId));
      if (!cur.hasOlder || !have?.length) return 0;
      const res = await page(channelId, () =>
        chatClient.listMessages({
          channelId,
          beforeId: have[0].id,
          limit: HISTORY_PAGE,
        }),
      );
      if (!res) return 0;
      let pruned = false;
      queryClient.setQueryData<Message[]>(key(channelId), (old) => {
        if (!old) return old;
        const seen = new Set(old.map((m) => m.id));
        let next = [...res.messages.filter((m) => !seen.has(m.id)), ...old];
        if (next.length > WINDOW_CAP) {
          next = next.slice(0, WINDOW_CAP);
          pruned = true;
        }
        return next;
      });
      patch(channelId, {
        hasOlder: res.hasOlder,
        // Dropping the newest rows means the window no longer ends at the
        // newest message; arrivals count on the pill from here.
        ...(pruned ? { hasNewer: true } : {}),
      });
      return res.messages.length;
    },

    loadNewer: async (queryClient, channelId) => {
      const cur = get().channels[channelId] ?? IDLE;
      const have = queryClient.getQueryData<Message[]>(key(channelId));
      if (!cur.hasNewer || !have?.length) return 0;
      const res = await page(channelId, () =>
        chatClient.listMessages({
          channelId,
          afterId: have[have.length - 1].id,
          limit: HISTORY_PAGE,
        }),
      );
      if (!res) return 0;
      let pruned = false;
      queryClient.setQueryData<Message[]>(key(channelId), (old) => {
        if (!old) return old;
        const seen = new Set(old.map((m) => m.id));
        let next = [...old, ...res.messages.filter((m) => !seen.has(m.id))];
        if (next.length > WINDOW_CAP) {
          next = next.slice(next.length - WINDOW_CAP);
          pruned = true;
        }
        return next;
      });
      patch(channelId, {
        hasNewer: res.hasNewer,
        ...(pruned ? { hasOlder: true } : {}),
        // Back at the newest message: everything that arrived is now loaded.
        ...(res.hasNewer ? {} : { pendingNewer: 0 }),
      });
      return res.messages.length;
    },

    jumpTo: async (queryClient, channelId, messageId) => {
      const res = await page(channelId, () =>
        chatClient.listMessages({
          channelId,
          aroundId: messageId,
          limit: HISTORY_PAGE,
        }),
      );
      if (!res) return false;
      queryClient.setQueryData<Message[]>(key(channelId), res.messages);
      get().seed(channelId, res);
      patch(channelId, { landOn: { id: messageId } });
      return true;
    },

    jumpToLatest: async (queryClient, channelId) => {
      if (isLive(get().channels[channelId])) return;
      const res = await page(channelId, () =>
        chatClient.listMessages({ channelId, limit: HISTORY_PAGE }),
      );
      if (!res) return;
      queryClient.setQueryData<Message[]>(key(channelId), res.messages);
      get().seed(channelId, res);
      patch(channelId, { landOn: "bottom" });
    },

    landed: (channelId) => patch(channelId, { landOn: undefined }),

    noteArrival: (channelId) =>
      set((s) => {
        const cur = s.channels[channelId];
        if (!cur?.hasNewer) return s;
        return {
          channels: {
            ...s.channels,
            [channelId]: { ...cur, pendingNewer: cur.pendingNewer + 1 },
          },
        };
      }),
  };
});
