import {
  type Timestamp,
  timestampDate,
  timestampFromDate,
} from "@bufbuild/protobuf/wkt";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { GetMeResponse, User } from "../gen/stoop/auth/v1/auth_pb";
import { authClient } from "./clients";

// Presence is online or offline, and do not disturb is the one thing a
// person chooses. It is stored on their account, so every device follows
// it; our own lives on the signed-in user in the "me" query, with no
// second copy to drift. docs/architecture/realtime.md.

// Whether do not disturb is on at now: set, and not past its end.
export function dndActive(
  user: Pick<User, "dnd" | "dndUntil"> | null | undefined,
  now = new Date(),
): boolean {
  if (!user?.dnd) return false;
  return !user.dndUntil || timestampDate(user.dndUntil) > now;
}

// dndActive, drawn again the moment the end passes: nothing arrives from
// the server when it does.
export function useDndActive(
  user: Pick<User, "dnd" | "dndUntil"> | null | undefined,
): boolean {
  const [, redraw] = useState(0);
  const on = dndActive(user);
  const end = on && user?.dndUntil ? timestampDate(user.dndUntil).getTime() : 0;
  useEffect(() => {
    if (!end) return;
    const timer = setTimeout(
      () => redraw((n) => n + 1),
      Math.max(0, end - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [end]);
  return on;
}

const HOUR = 60 * 60 * 1000;

// How long do not disturb lasts when turned on. The desktop app offers the
// same list in App settings.
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

// The dot's modifier: an empty ring, a filled dot, or a dot with a bar
// through it (styles/presence.css). Offline beats do not disturb: the dot
// is whether they can be reached.
export function presenceClass(
  online: boolean,
  dnd: boolean | undefined,
): "offline" | "dnd" | "online" {
  if (!online) return "offline";
  return dnd ? "dnd" : "online";
}

export function presenceLabel(
  online: boolean,
  dnd: boolean | undefined,
): string {
  if (!online) return "offline";
  return dnd ? "do not disturb" : "online";
}

// Whether our own alerts are held right now.
export function myDnd(queryClient: QueryClient): boolean {
  return dndActive(queryClient.getQueryData<GetMeResponse>(["me"])?.user);
}

// Writes do not disturb onto the cached signed-in user: the answer to our
// own change, or a change made on another device.
export function patchMyDnd(
  queryClient: QueryClient,
  dnd: boolean,
  until: Timestamp | undefined,
) {
  queryClient.setQueryData<GetMeResponse>(["me"], (old) =>
    old?.user ? { ...old, user: { ...old.user, dnd, dndUntil: until } } : old,
  );
}

export async function setDoNotDisturb(
  queryClient: QueryClient,
  on: boolean,
  until?: Date,
) {
  const res = await authClient.setDoNotDisturb({
    on,
    until: until ? timestampFromDate(until) : undefined,
  });
  if (res.user) patchMyDnd(queryClient, res.user.dnd, res.user.dndUntil);
}
