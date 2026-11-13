import type { SharedLink } from "./sharedLink";

// The one shared link waiting to be opened, left by +native-intent.tsx,
// which hears it before anything has rendered and knows no servers, for
// OpenSharedLink.tsx, which does. Outside React for that reason. Taken
// once, and let go when nobody takes it in time (the saved servers
// couldn't be read), so the app doesn't jump somewhere minutes later.

export const LINK_WAIT_MS = 10_000;

let pending: { link: SharedLink; at: number } | null = null;
const listeners = new Set<() => void>();

export function heardLink(link: SharedLink, now = Date.now()) {
  pending = { link, at: now };
  for (const listener of listeners) listener();
}

export function takeLink(now = Date.now()): SharedLink | null {
  const waiting = pending;
  pending = null;
  return waiting && now - waiting.at <= LINK_WAIT_MS ? waiting.link : null;
}

// Calls back as a link is heard, until the returned function is called.
export function onLink(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
