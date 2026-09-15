import {
  type Timestamp,
  timestampDate,
  timestampFromDate,
} from "@bufbuild/protobuf/wkt";
import type { QueryClient } from "@tanstack/react-query";
import type { GetMeResponse, User } from "../gen/stoop/auth/v1/auth_pb";
import { authClient } from "./clients";

// Presence is online or offline, and do not disturb is the one thing a
// person chooses. It is stored on their account, so every device follows
// it; our own lives on the signed-in user in the "me" query, with no
// second copy to drift. docs/proposals/presence-and-dnd.md.

// Whether do not disturb is on at now: set, and not past its end.
export function dndActive(
  user: Pick<User, "dnd" | "dndUntil"> | null | undefined,
  now = new Date(),
): boolean {
  if (!user?.dnd) return false;
  return !user.dndUntil || timestampDate(user.dndUntil) > now;
}

// The dot's modifier for someone who is online.
export function presenceClass(dnd: boolean | undefined): "dnd" | "online" {
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
