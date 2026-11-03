import type { QueryClient } from "@tanstack/react-query";
import { isUnread } from "../core/unreads";
import type { Channel } from "../gen/stoop/chat/v1/channel_pb";
import type { Space } from "../gen/stoop/chat/v1/space_pb";
import { chatClient } from "./clients";
import { patchDirectMessage } from "./dms";
import { isMuted } from "./mutes";

// Unread state lives on the server (channel_reads); the client keeps the
// channels/spaces caches in step with realtime events so bolding is
// instant without refetches.

// A message shown read the moment it landed in the channel being read
// (api/ws.ts), by channel, until useMarkChannelRead has told the server.
// Kept apart from the cache, and sent only by the hook for the channel
// on screen, so a message judged "being read" while the page was already
// on its way elsewhere is never read on the server by a channel nobody
// is looking at; the channel's record is right again on its next list.
const readOnArrival = new Map<string, string>();

export function noteReadOnArrival(channelId: string, messageId: string) {
  readOnArrival.set(channelId, messageId);
}

// The message still to be sent for a channel, if its record still shows
// it as the one read: a later own message, or a list fetched since,
// has moved past it otherwise.
export function readOnArrivalTarget(channel: Channel): string {
  const pending = readOnArrival.get(channel.id);
  return pending && pending === channel.lastReadMessageId ? pending : "";
}

export function clearReadOnArrival(channelId: string, messageId: string) {
  if ((readOnArrival.get(channelId) ?? "") <= messageId) {
    readOnArrival.delete(channelId);
  }
}

// Moves the server's read marker for a channel to messageId and shows it
// read here at once; the ChannelRead event that follows is what refetches
// the activity feed and the alert counts the marker passed.
export async function markChannelRead(
  queryClient: QueryClient,
  spaceId: string,
  channelId: string,
  messageId: string,
) {
  await chatClient.markChannelRead({ channelId, messageId });
  clearReadOnArrival(channelId, messageId);
  // Only forward: two calls out at once may answer in either order.
  patchChannel(queryClient, spaceId, channelId, (c) =>
    c.lastReadMessageId >= messageId
      ? {}
      : { lastReadMessageId: messageId, unreadCount: 0 },
  );
  recomputeSpaceUnread(queryClient, spaceId);
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
          | "lastMessageId"
          | "lastReadMessageId"
          | "unreadCount"
          | "alertCount"
          | "muted"
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
