import type { ServerEvent } from "@stoop/gen/stoop/realtime/v1/realtime_pb";

// How one online person is: on do not disturb or not, and online only in
// a mobile app or not.
export type Online = { dnd: boolean; mobile: boolean };

// What a screen is told about one person: online or not, and while
// online, on do not disturb or not and online only in a mobile app or not.
export type Presence = { online: boolean } & Online;
export const OFFLINE: Presence = { online: false, dnd: false, mobile: false };

// Who is online on one server, by user ID: the people who share a space
// with this account. Someone not in it is offline. Seeded by Ready and
// kept current by PresenceChanged, as web's connection store is
// (web/src/stores/connection.ts).
export type PresenceRoster = Record<string, Online>;

// The roster after one event; the same object when the event changes
// nothing in it.
export function applyPresenceEvent(roster: PresenceRoster | undefined, event: ServerEvent): PresenceRoster | undefined {
  const payload = event.payload;
  switch (payload.case) {
    case "ready":
      return Object.fromEntries(
        payload.value.presences.map(({ userId, dnd, mobile }) => [userId, { dnd, mobile }]),
      );
    case "presenceChanged": {
      const { userId, online, dnd, mobile } = payload.value;
      if (!roster) return roster;
      const held = roster[userId];
      if (!online) {
        if (!held) return roster;
        const next = { ...roster };
        delete next[userId];
        return next;
      }
      if (held && held.dnd === dnd && held.mobile === mobile) return roster;
      return { ...roster, [userId]: { dnd, mobile } };
    }
    default:
      return roster;
  }
}
