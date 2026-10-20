import type { ServerEvent, VoiceParticipant } from "@stoop/gen/stoop/realtime/v1/realtime_pb";

// Who is in which voice room on one server, by user ID: someone is in at
// most one room at a time. Seeded by Ready and kept current by
// VoiceStateChanged, as web's voice store is (web/src/stores/voice.ts).
export type VoiceRoster = Record<string, VoiceParticipant>;

// The roster after one event; the same object when the event changes
// nothing in it.
export function applyVoiceEvent(roster: VoiceRoster | undefined, event: ServerEvent): VoiceRoster | undefined {
  const payload = event.payload;
  switch (payload.case) {
    case "ready":
      return Object.fromEntries(payload.value.voiceParticipants.map((participant) => [participant.userId, participant]));
    case "voiceStateChanged": {
      const { participant, joined } = payload.value;
      if (!roster || !participant) return roster;
      const next = { ...roster };
      if (joined) next[participant.userId] = participant;
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
