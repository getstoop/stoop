import type { NotificationData } from "./content";

// The tapped notification waiting to be opened. A tap is heard at the
// root of the app (taps.ts), but its message opens on a server's own
// stack, which only that server's layout can push onto, and which may
// not be the server on screen, or mounted at all yet when the tap
// launched the app. So the root leaves the tap here and the server
// layout on screen (OpenTappedNotification.tsx) picks it up: its own it
// takes and opens; another saved server's it swaps to, and that
// server's layout takes it as it mounts. Kept outside React so it
// outlives the swap between the two.
//
// Each tap is opened once. The system reports a tap both as an event
// and as its "last response", and either may be read again after a
// re-render or a return from the background, so a response is accepted
// by its key only the first time; and what is taken is gone. A tap
// nobody took in time is dropped: the app just opened, and it won't
// jump somewhere minutes later.

export const TAP_WAIT_MS = 10_000;

let pending: { data: NotificationData; at: number } | null = null;
let lastKey: string | undefined;
const listeners = new Set<() => void>();

// Holds a tap for whoever opens it. False when this response has been
// accepted before.
export function acceptTap(key: string, data: NotificationData, now = Date.now()): boolean {
  if (key === lastKey) return false;
  lastKey = key;
  pending = { data, at: now };
  for (const listener of listeners) listener();
  return true;
}

// The tap waiting, left where it is.
export function pendingTap(now = Date.now()): NotificationData | null {
  if (pending && now - pending.at > TAP_WAIT_MS) pending = null;
  return pending?.data ?? null;
}

// The tap waiting, if it is this server's, and it waits no more.
export function takeTap(serverId: string, now = Date.now()): NotificationData | null {
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
