import {
  type Timestamp,
  timestampDate,
  timestampFromDate,
} from "@bufbuild/protobuf/wkt";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { dndActive } from "../core/doNotDisturb";
import type { GetMeResponse, User } from "../gen/stoop/auth/v1/auth_pb";
import { authClient } from "./clients";

// Presence is online or offline, online only on mobile apps or not, and
// do not disturb is the one thing a person chooses. It is stored on their account, so every device follows
// it; our own lives on the signed-in user in the "me" query, with no
// second copy to drift. Whether it is on, and the durations it is turned on
// for, are core/doNotDisturb.ts, which the mobile app shares.
// docs/architecture/realtime.md.

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
