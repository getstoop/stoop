import { ActivityKind } from "@stoop/gen/stoop/chat/v1/activity_pb";
import { type Channel, ChannelKind } from "@stoop/gen/stoop/chat/v1/channel_pb";
import type { Member } from "@stoop/gen/stoop/chat/v1/member_pb";
import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";
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
  const [{ space }, { channels }, { members }, { items }] = await Promise.all([
    chat.getSpace({ spaceId }, options),
    chat.listChannels({ spaceId }, options),
    chat.listMembers({ spaceId }, options),
    chat.listActivity({}, options),
  ]);
  if (!space) throw new Error("The server answered with no space.");
  const mentions: Record<string, number> = {};
  for (const item of items) {
    if (item.spaceId !== spaceId || item.readAt || item.muted || item.kind === ActivityKind.THREAD_REPLY) continue;
    mentions[item.channelId] = (mentions[item.channelId] ?? 0) + 1;
  }
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
