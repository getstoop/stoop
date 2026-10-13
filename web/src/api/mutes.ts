import type { QueryClient } from "@tanstack/react-query";
import { type Channel, ChannelKind } from "../gen/stoop/chat/v1/channel_pb";
import type { DirectMessage } from "../gen/stoop/chat/v1/chat_pb";
import type { Space } from "../gen/stoop/chat/v1/space_pb";

// Where the effective mute state is derived, once, for every attention
// surface. The wire carries the raw rows (a space's and a channel's own);
// callers ask here rather than reading `muted` off a message.
//
// `undefined` means the cache is cold, and callers treat that as unmuted:
// a banner or badge you did get beats one you did not.

// The caller's own row for a space, from the spaces list.
export function spaceMuted(
  queryClient: QueryClient,
  spaceId: string,
): boolean | undefined {
  const spaces = queryClient.getQueryData<Space[]>(["spaces"]);
  if (!spaces) return undefined;
  return !!spaces.find((s) => s.id === spaceId)?.muted;
}

// The caller's own row for a channel, from whichever list holds it.
export function channelMuted(
  queryClient: QueryClient,
  spaceId: string,
  channelId: string,
): boolean | undefined {
  if (spaceId) {
    const channels = queryClient.getQueryData<Channel[]>(["channels", spaceId]);
    if (!channels) return undefined;
    return !!channels.find((c) => c.id === channelId)?.muted;
  }
  const dms = queryClient.getQueryData<DirectMessage[]>(["dms"]);
  if (!dms) return undefined;
  return !!dms.find((d) => d.channel?.id === channelId)?.channel?.muted;
}

// Effective: the channel's own row or its space's. A direct message has no
// space, so only its own applies.
export function isMuted(
  queryClient: QueryClient,
  spaceId: string,
  channelId: string,
): boolean | undefined {
  const channel = channelMuted(queryClient, spaceId, channelId);
  if (channel) return true;
  const space = spaceId ? spaceMuted(queryClient, spaceId) : false;
  if (space) return true;
  return channel === undefined || space === undefined ? undefined : false;
}

// A text channel the caller muted themselves, which the sidebar leaves out
// and the Muted channels panel lists. A muted space hides nothing, and
// voice channels stay where they are.
export function mutedByCaller(channel: Channel): boolean {
  return channel.muted && channel.kind !== ChannelKind.VOICE;
}

// The text channels the sidebar lists: those the caller has not muted, in
// their order, then the muted one being read, if any. It goes last so
// opening it moves no other row, and it leaves when the reader does.
export function sidebarTextChannels(
  channels: Channel[] | undefined,
  openChannelId: string | undefined,
): Channel[] {
  const text = channels?.filter((c) => c.kind !== ChannelKind.VOICE) ?? [];
  const listed = text.filter((c) => !mutedByCaller(c));
  const reading = text.find((c) => mutedByCaller(c) && c.id === openChannelId);
  return reading ? [...listed, reading] : listed;
}
