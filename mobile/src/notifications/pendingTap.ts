import type { NotificationData } from "./content";

// What a tap opens: a notification's data, or the place a shared link
// names (links/OpenSharedLink.tsx), which has no activity item to mark
// read and, for a link to a space, no channel.
export type Tap = Omit<NotificationData, "itemId" | "kind"> & { itemId?: string };

// The one tapped notification waiting to be opened, left by whoever
// heard the tap (taps.ts) for the server layout that opens it
// (OpenTappedNotification.tsx); outside React, so it outlives a swap
// from one server's layout to another's. A tap is accepted once by its
// key, taken once, and dropped when nobody takes it in time, so the app
// doesn't jump somewhere minutes later.

export const TAP_WAIT_MS = 10_000;

let pending: { data: Tap; at: number } | null = null;
let lastKey: string | undefined;
const listeners = new Set<() => void>();

// Holds a tap for whoever opens it, unless its key was accepted before.
// A shared link has no key (null): each is its own, and it leaves the
// last notification's key as it was.
export function acceptTap(key: string | null, data: Tap, now = Date.now()) {
  if (key !== null) {
    if (key === lastKey) return;
    lastKey = key;
  }
  pending = { data, at: now };
  for (const listener of listeners) listener();
}

// The tap waiting, left where it is.
export function pendingTap(now = Date.now()): Tap | null {
  if (pending && now - pending.at > TAP_WAIT_MS) pending = null;
  return pending?.data ?? null;
}

// The tap waiting, if it is this server's, and it waits no more.
export function takeTap(serverId: string, now = Date.now()): Tap | null {
  const tap = pendingTap(now);
  if (tap?.serverId !== serverId) return null;
  pending = null;
  return tap;
}

export function dropTap() {
  pending = null;
}

// Calls back as a tap is accepted, until the returned function is called.
export function onTap(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
