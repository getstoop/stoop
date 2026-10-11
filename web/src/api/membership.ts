import type { QueryClient } from "@tanstack/react-query";
import type { Channel } from "../gen/stoop/chat/v1/channel_pb";
import { inChannel, recomputeSpaceUnread } from "./unreads";

// Who is in a text channel, as the channels cache holds it. The cache
// lists every channel of a space with the caller's own `joined`; these
// keep it in step with the two membership events.

function cached(
  queryClient: QueryClient,
  spaceId: string,
  channelId: string,
): Channel | undefined {
  return queryClient
    .getQueryData<Channel[]>(["channels", spaceId])
    ?.find((channel) => channel.id === channelId);
}

// The list is loaded and says the caller is not in this channel. False
// while the list is cold: nothing is known then, and the server's own
// unread flag decides.
export function knownOutside(
  queryClient: QueryClient,
  spaceId: string,
  channelId: string,
): boolean {
  const channel = cached(queryClient, spaceId, channelId);
  return !!channel && !inChannel(channel);
}

function patchMembers(
  queryClient: QueryClient,
  spaceId: string,
  channelId: string,
  patch: (channel: Channel) => Partial<Channel>,
) {
  queryClient.setQueryData<Channel[]>(["channels", spaceId], (old) =>
    old?.map((channel) =>
      channel.id === channelId ? { ...channel, ...patch(channel) } : channel,
    ),
  );
}

// Someone joined a channel. When it is the caller (from another device,
// an admin's add or a mention) the list is refetched: the read marker and
// unread count that came with the join are the server's to say.
export function applyMemberJoined(
  queryClient: QueryClient,
  event: { spaceId: string; channelId: string; userId: string },
  me: string | null,
) {
  queryClient.invalidateQueries({
    queryKey: ["channel-members", event.channelId],
  });
  patchMembers(queryClient, event.spaceId, event.channelId, (channel) => ({
    memberCount: channel.memberCount + 1,
    ...(event.userId === me ? { joined: true } : {}),
  }));
  if (event.userId !== me) return;
  queryClient.invalidateQueries({ queryKey: ["channels", event.spaceId] });
  queryClient.invalidateQueries({ queryKey: ["spaces"] });
}

// Someone left a channel. For the caller it stops being unread, and the
// mute they had on it is gone with it.
export function applyMemberLeft(
  queryClient: QueryClient,
  event: { spaceId: string; channelId: string; userId: string },
  me: string | null,
) {
  queryClient.invalidateQueries({
    queryKey: ["channel-members", event.channelId],
  });
  patchMembers(queryClient, event.spaceId, event.channelId, (channel) => ({
    memberCount: Math.max(0, channel.memberCount - 1),
    ...(event.userId === me
      ? { joined: false, muted: false, unreadCount: 0 }
      : {}),
  }));
  if (event.userId === me) recomputeSpaceUnread(queryClient, event.spaceId);
}

// A channel became required: everyone is in it. The caller's row is
// refetched for the read marker the server gave them.
export function applyRequired(
  queryClient: QueryClient,
  spaceId: string,
  channelId: string,
) {
  queryClient.invalidateQueries({ queryKey: ["channel-members", channelId] });
  const channel = cached(queryClient, spaceId, channelId);
  if (!channel || inChannel(channel)) return;
  queryClient.invalidateQueries({ queryKey: ["channels", spaceId] });
}
