import { type Channel, ChannelKind } from "@stoop/gen/stoop/chat/v1/channel_pb";
import type { Member } from "@stoop/gen/stoop/chat/v1/member_pb";
import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";
import type { ServerEvent } from "@stoop/gen/stoop/realtime/v1/realtime_pb";
import { chatClient } from "./clients";

// A space's channels, the Spaces tab's pane: the space, its text and
// voice channels in the space's order, each text channel carrying what
// is waiting in it
// (`unreadCount`, `alertCount`, `muted`, the caller's own), and its
// members, for the count under the name and the faces in voice rooms. A
// snapshot, fetched again on pull and on coming back to the app; who is
// in voice arrives over the realtime socket instead.

export type SpaceChannels = {
  space: Space;
  text: Channel[];
  voice: Channel[];
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
  const [{ space }, { channels }, { members }] = await Promise.all([
    chat.getSpace({ spaceId }, options),
    chat.listChannels({ spaceId }, options),
    chat.listMembers({ spaceId }, options),
  ]);
  if (!space) throw new Error("The server answered with no space.");
  const ordered = [...channels].sort((one, other) => one.position - other.position);
  return {
    space,
    text: ordered.filter((channel) => channel.kind === ChannelKind.TEXT),
    voice: ordered.filter((channel) => channel.kind === ChannelKind.VOICE),
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

// Whether an event could change what a space's channels show: its
// channels and their order, mutes, unreads and alert counts (a message
// created can be addressed to the reader; one deleted or edited can take
// an unread or an alert with it; a thread muted changes which alerts
// count; a read marker, channel or thread, reads the alerts it passes),
// the space itself, or who is in it. Ready follows a reconnect, when
// anything may have been missed. Who is in voice is not here: the roster
// follows it.
export function touchesSpace(event: ServerEvent, spaceId: string): boolean {
  return event.payload.case === "ready" || eventSpaceId(event) === spaceId;
}

// The space an event of those kinds is about: "" for one in a direct
// message, undefined for a kind that changes nothing a space's channels
// show. The Spaces tab's rail reads the same kinds for every space
// (`touchesSpaces` in ./spaces.ts).
export function eventSpaceId(event: ServerEvent): string | undefined {
  const payload = event.payload;
  switch (payload.case) {
    case "channelCreated":
    case "channelUpdated":
    case "messageCreated":
    case "messageUpdated":
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
      return payload.value.spaceId;
    case "spaceUpdated":
      return payload.value.space?.id;
    default:
      return undefined;
  }
}
