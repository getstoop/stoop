import type { QueryClient } from "@tanstack/react-query";
import type { Channel } from "../gen/stoop/chat/v1/channel_pb";
import type { Space } from "../gen/stoop/chat/v1/space_pb";
import { patchDirectMessage } from "./dms";
import { isMuted } from "./mutes";

// Unread state lives on the server (channel_reads); the client keeps the
// channels/spaces caches in step with realtime events so bolding is
// instant without refetches.

// Badge pills are narrow, and past a hundred the exact number stops
// telling you anything you'd act on.
export function badgeCount(n: number): string {
  return n > 99 ? "99+" : String(n);
}

export function isUnread(c: Channel): boolean {
  return c.lastMessageId !== "" && c.lastMessageId > c.lastReadMessageId;
}

// Unread and not effectively muted: what bolds a row and dots a pill.
export function isAlerting(
  queryClient: QueryClient,
  spaceId: string,
  c: Channel,
): boolean {
  return isUnread(c) && !isMuted(queryClient, spaceId, c.id);
}

export function patchChannel(
  queryClient: QueryClient,
  spaceId: string,
  channelId: string,
  patch:
    | Partial<
        Pick<
          Channel,
          "lastMessageId" | "lastReadMessageId" | "unreadCount" | "muted"
        >
      >
    | ((c: Channel) => Partial<Channel>),
) {
  // No space: a direct message, kept in its own list.
  if (spaceId === "") {
    patchDirectMessage(queryClient, channelId, (c) =>
      typeof patch === "function" ? patch(c) : patch,
    );
    return;
  }
  queryClient.setQueryData<Channel[]>(["channels", spaceId], (old) =>
    old?.map((c) =>
      c.id === channelId
        ? { ...c, ...(typeof patch === "function" ? patch(c) : patch) }
        : c,
    ),
  );
}

export function setSpaceUnread(
  queryClient: QueryClient,
  spaceId: string,
  hasUnread: boolean,
) {
  if (spaceId === "") return; // the DMs pill derives its dot from the list
  queryClient.setQueryData<Space[]>(["spaces"], (old) =>
    old?.map((s) => (s.id === spaceId ? { ...s, hasUnread } : s)),
  );
}

// After a channel is read, the space is unread only if another of its
// (loaded) channels still is.
export function recomputeSpaceUnread(
  queryClient: QueryClient,
  spaceId: string,
) {
  if (spaceId === "") return;
  const channels = queryClient.getQueryData<Channel[]>(["channels", spaceId]);
  if (!channels) {
    queryClient.invalidateQueries({ queryKey: ["spaces"] });
    return;
  }
  setSpaceUnread(
    queryClient,
    spaceId,
    channels.some((c) => isAlerting(queryClient, spaceId, c)),
  );
}
