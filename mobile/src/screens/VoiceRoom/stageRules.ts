import type { Member } from "@stoop/gen/stoop/chat/v1/member_pb";
import type { VoiceParticipant } from "@stoop/gen/stoop/realtime/v1/realtime_pb";
import { memberName } from "../../api/channels";

// The rules of a voice room's Stage: who is on it, how its tiles are
// sized by head count, and what its lines say.

export type StagePerson = {
  userId: string;
  name: string;
  avatarFileId: string;
  // Their own report of their microphone, from the roster.
  muted: boolean;
};

// The room's people as the Stage draws them, in the roster's order.
// Someone the member list doesn't have yet (joined the space since it
// loaded) is "Someone" until it reloads.
export function stagePeople(
  participants: Pick<VoiceParticipant, "userId" | "muted">[],
  members: Record<string, Pick<Member, "displayName" | "username" | "avatarFileId">>,
): StagePerson[] {
  return participants.map((participant) => {
    const member = members[participant.userId];
    return {
      userId: participant.userId,
      name: member ? memberName(member) : "Someone",
      avatarFileId: member?.avatarFileId ?? "",
      muted: participant.muted,
    };
  });
}

export type TileSize = "tall" | "regular" | "small";

// One or two people stack full width in tall tiles; more form two
// columns, in smaller tiles from five.
export function stageLayout(count: number): { columns: 1 | 2; size: TileSize } {
  if (count <= 2) return { columns: 1, size: "tall" };
  return { columns: 2, size: count <= 4 ? "regular" : "small" };
}

// Under the room's name in the header: the space, and how many are in
// the room once that is known.
export function roomAbout(spaceName: string, count: number | undefined): string {
  return count === undefined ? spaceName : `${spaceName} · ${count} here`;
}

// Over Join: "Priya is here", "Priya and Theo are here", "Priya, Theo
// and Sam are here", then "Priya, Theo and 3 others are here". "" for
// an empty room.
export function hereLine(names: string[]): string {
  switch (names.length) {
    case 0:
      return "";
    case 1:
      return `${names[0]} is here`;
    case 2:
      return `${names[0]} and ${names[1]} are here`;
    case 3:
      return `${names[0]}, ${names[1]} and ${names[2]} are here`;
    default:
      return `${names[0]}, ${names[1]} and ${names.length - 2} others are here`;
  }
}

// What a screen reader is told of a tile.
export function tileLabel(person: Pick<StagePerson, "name" | "muted">): string {
  return person.muted ? `${person.name}, muted` : person.name;
}
