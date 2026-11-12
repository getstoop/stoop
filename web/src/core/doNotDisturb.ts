import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { User } from "../gen/stoop/auth/v1/auth_pb";

// Do not disturb as an account carries it, for web's menu and the mobile
// app's switch: whether it is on right now, and the durations it is turned
// on for. docs/architecture/realtime.md.

// Whether do not disturb is on at now: set, and not past its end.
export function dndActive(
  user: Pick<User, "dnd" | "dndUntil"> | null | undefined,
  now = new Date(),
): boolean {
  if (!user?.dnd) return false;
  return !user.dndUntil || timestampDate(user.dndUntil) > now;
}

const HOUR = 60 * 60 * 1000;

// How long do not disturb lasts when turned on. The desktop app offers the
// same list in App settings, and the mobile app in its Notifications.
export const DND_DURATIONS = [
  { key: "1h", label: "1 hour", ms: HOUR },
  { key: "3h", label: "3 hours", ms: 3 * HOUR },
  { key: "1d", label: "1 day", ms: 24 * HOUR },
  { key: "1w", label: "1 week", ms: 7 * 24 * HOUR },
  { key: "never", label: "Never expire", ms: null },
] as const;

// Where the control stands: off, on with no end, or on until an end
// already chosen.
export function dndChoice(
  user: Pick<User, "dnd" | "dndUntil"> | null | undefined,
  now = new Date(),
): "off" | "never" | "until" {
  if (!dndActive(user, now)) return "off";
  return user?.dndUntil ? "until" : "never";
}

// The end a duration picked at now gives, or undefined for none.
export function dndEnd(key: string, now = new Date()): Date | undefined {
  const ms = DND_DURATIONS.find((d) => d.key === key)?.ms;
  return ms ? new Date(now.getTime() + ms) : undefined;
}
