import type { ServerEvent, VoiceParticipant } from "@stoop/gen/stoop/realtime/v1/realtime_pb";

// Who is in which voice room on one server, by user ID: someone is in at
// most one room at a time. Seeded by Ready and kept current by
// VoiceStateChanged, as web's voice store is (web/src/stores/voice.ts).
export type VoiceRoster = Record<string, VoiceParticipant>;

// The roster after one event; the same object when the event changes
// nothing in it. A room's people are in the order they joined, as far
// as this app has seen: the server keeps no join time and its Ready
// lists them in no order, so that is the order of whoever was already
// there, and whoever joins after goes last. `before` is the roster as
// it last was on this server, so a reconnect's Ready moves nobody who
// stayed.
export function applyVoiceEvent(
  roster: VoiceRoster | undefined,
  event: ServerEvent,
  before?: VoiceRoster,
): VoiceRoster | undefined {
  const payload = event.payload;
  switch (payload.case) {
    case "ready": {
      // Whoever was in a room before the socket dropped and still is
      // keeps their place; the rest follow in the server's order.
      const now = new Map(payload.value.voiceParticipants.map((participant) => [participant.userId, participant]));
      const kept = Object.values(before ?? {}).flatMap((held) => {
        const same = now.get(held.userId);
        return same?.channelId === held.channelId ? [same] : [];
      });
      const keptIds = new Set(kept.map((participant) => participant.userId));
      const rest = payload.value.voiceParticipants.filter((participant) => !keptIds.has(participant.userId));
      return Object.fromEntries([...kept, ...rest].map((participant) => [participant.userId, participant]));
    }
    case "voiceStateChanged": {
      const { participant, joined } = payload.value;
      if (!roster || !participant) return roster;
      const next = { ...roster };
      if (joined) {
        // Someone coming from another room is new to this one: they go
        // last, as anyone joining does. A change of state keeps its place.
        if (next[participant.userId]?.channelId !== participant.channelId) delete next[participant.userId];
        next[participant.userId] = participant;
      }
      else if (next[participant.userId]?.channelId === participant.channelId) delete next[participant.userId];
      return next;
    }
    case "channelDeleted": {
      const { channelId } = payload.value;
      if (!roster) return roster;
      return Object.fromEntries(Object.entries(roster).filter(([, participant]) => participant.channelId !== channelId));
    }
    default:
      return roster;
  }
}

// The people in one room, in the order the roster has them.
export function inRoom(roster: VoiceRoster | undefined, channelId: string): VoiceParticipant[] {
  return Object.values(roster ?? {}).filter((participant) => participant.channelId === channelId);
}
