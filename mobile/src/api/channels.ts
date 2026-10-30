import { unreadCounts } from "@stoop/core/activity";
import { type Channel, ChannelKind } from "@stoop/gen/stoop/chat/v1/channel_pb";
import type { Member } from "@stoop/gen/stoop/chat/v1/member_pb";
import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";
import type { ServerEvent } from "@stoop/gen/stoop/realtime/v1/realtime_pb";
import { chatClient } from "./clients";

// A space's channels screen: the space, its text and voice channels in
// the space's order, each text channel's unread mentions, and its members,
// for the count under the name and the faces in voice rooms. A snapshot,
// fetched again on pull and on coming back to the app; who is in voice
// arrives over the realtime socket instead.

export type SpaceChannels = {
  space: Space;
  text: Channel[];
  voice: Channel[];
  // By channel ID, counted as the Spaces tab counts a space's
  // (api/spaces.ts): unread, not muted, not thread replies.
  mentions: Record<string, number>;
  // By user ID.
  members: Record<string, Member>;
  memberCount: number;
};

const TIMEOUT_MS = 10000;

export async function loadSpaceChannels(
  origin: string,
  token: string,
  spaceId: string,
  signal?: AbortSignal,
): Promise<SpaceChannels> {
  const chat = chatClient(origin, token);
  const options = { signal, timeoutMs: TIMEOUT_MS };
  const [{ space }, { channels }, { members }, activity] = await Promise.all([
    chat.getSpace({ spaceId }, options),
    chat.listChannels({ spaceId }, options),
    chat.listMembers({ spaceId }, options),
    chat.listActivity({}, options),
  ]);
  if (!space) throw new Error("The server answered with no space.");
  // Counted over the whole feed; channel IDs are unique on a server, so
  // looking up this space's channels finds only their own.
  const mentions = Object.fromEntries(unreadCounts(activity).byChannel);
  const ordered = [...channels].sort((one, other) => one.position - other.position);
  return {
    space,
    text: ordered.filter((channel) => channel.kind === ChannelKind.TEXT),
    voice: ordered.filter((channel) => channel.kind === ChannelKind.VOICE),
    mentions,
    members: Object.fromEntries(members.map((member) => [member.userId, member])),
    memberCount: members.length,
  };
}

export function memberName(member: Pick<Member, "displayName" | "username">): string {
  return member.displayName || member.username;
}

// Who is in a voice room, in one line that fits: "Priya", "Priya and
// Theo", then "Priya and Theo + 5 more" past two.
export function voiceNames(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names[0]} and ${names[1]} + ${names.length - 2} more`;
}

// Whether an event could change what a space's channels screen shows:
// its channels and their order, mutes, reads and mentions (a message
// deleted or edited can take an unread or a mention with it; a thread
// muted changes which mentions count; a read marker, channel or thread,
// reads the mentions it passes), the space itself, or who is in it.
// Ready follows a reconnect, when anything may have been missed. Who is
// in voice is not here: the roster follows it.
export function touchesSpace(event: ServerEvent, spaceId: string): boolean {
  const payload = event.payload;
  switch (payload.case) {
    case "ready":
      return true;
    case "channelCreated":
    case "channelUpdated":
    case "messageCreated":
    case "messageUpdated":
      return payload.value.spaceId === spaceId;
    case "channelDeleted":
    case "channelsReordered":
    case "channelMuted":
    case "channelRead":
    case "threadRead":
    case "messageDeleted":
    case "threadMuted":
    case "spaceMuted":
    case "spaceDeleted":
    case "memberJoined":
    case "memberRemoved":
    case "memberUpdated":
    case "channelMemberJoined":
    case "channelMemberLeft":
      return payload.value.spaceId === spaceId;
    case "spaceUpdated":
      return payload.value.space?.id === spaceId;
    case "activityItemCreated":
      return payload.value.item?.spaceId === spaceId;
    default:
      return false;
  }
}
