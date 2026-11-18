import { ActivityKind } from "@stoop/gen/stoop/chat/v1/activity_pb";
import { type AlertPrefs, serverAlerts } from "../alertPrefs/prefs";

// What the phone keeps of one server's push subscription, so it can tell
// when to renew it (renewal.ts) and register it again: the endpoint the
// relay issued and when, what it was issued for (this phone's APNs token
// and the server's key), and what the server was told (the kinds).
export type PushRecord = {
  // The sign-in it was registered by: a later sign-in to the same server
  // is another session, which has no subscription until it registers.
  session: number;
  localServerId: string;
  endpoint: string;
  // When the relay issued the endpoint, by this phone's clock, and when
  // the relay says it stops working.
  issuedAt: number;
  expiresAt: number;
  vapidKey: string;
  deviceToken: string;
  kinds: ActivityKind[];
  // The last check that completed: the day rule's start.
  checkedAt: number;
};

// A stored record as it was saved, or null for anything else: a record
// that can't be read is no record, which renews.
export function parseRecord(raw: string | null): PushRecord | null {
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as Partial<PushRecord> | null;
    if (
      !saved ||
      typeof saved.session !== "number" ||
      typeof saved.localServerId !== "string" ||
      typeof saved.endpoint !== "string" ||
      typeof saved.issuedAt !== "number" ||
      typeof saved.expiresAt !== "number" ||
      typeof saved.vapidKey !== "string" ||
      typeof saved.deviceToken !== "string" ||
      typeof saved.checkedAt !== "number" ||
      !Array.isArray(saved.kinds) ||
      !saved.kinds.every((kind) => typeof kind === "number")
    ) {
      return null;
    }
    return saved as PushRecord;
  } catch {
    return null;
  }
}

// The activity a server's pushes carry, from the Notifications screen's
// switches (src/alertPrefs), the same ones that hold a banner in the app:
// none while that server's switch is off, which keeps the subscription
// and has the server send nothing.
export function wantedKinds(prefs: AlertPrefs, serverId: string): ActivityKind[] {
  if (!serverAlerts(prefs, serverId)) return [];
  const kinds: ActivityKind[] = [];
  if (prefs.mentions) kinds.push(ActivityKind.MENTION, ActivityKind.REPLY);
  if (prefs.directMessages) kinds.push(ActivityKind.DM);
  if (prefs.threads) kinds.push(ActivityKind.THREAD_REPLY);
  return kinds;
}

export function sameKinds(one: readonly ActivityKind[], other: readonly ActivityKind[]): boolean {
  if (one.length !== other.length) return false;
  const sorted = [...other].sort();
  return [...one].sort().every((kind, index) => kind === sorted[index]);
}
