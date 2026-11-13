// The one invite link waiting to be opened, left by +native-intent.tsx,
// which hears it before anything has rendered and knows no servers, for
// whichever of two that do: OpenInviteHere.tsx, in a server's layout,
// when the invite is to a saved server, and OpenInviteLink.tsx when it
// isn't. Each looks first (`peekInvite`) and takes only its own. As
// pendingLink.ts holds a shared link: outside React, taken once, and
// let go when nobody takes it in time, so the app doesn't jump
// somewhere minutes later.

export const INVITE_WAIT_MS = 10_000;

let pending: { link: string; at: number } | null = null;
const listeners = new Set<() => void>();

export function heardInvite(link: string, now = Date.now()) {
  pending = { link, at: now };
  for (const listener of listeners) listener();
}

// The invite waiting, left where it is.
export function peekInvite(now = Date.now()): string | null {
  return pending && now - pending.at <= INVITE_WAIT_MS ? pending.link : null;
}

export function takeInvite(now = Date.now()): string | null {
  const waiting = pending;
  pending = null;
  return waiting && now - waiting.at <= INVITE_WAIT_MS ? waiting.link : null;
}

// Calls back as an invite is heard, until the returned function is called.
export function onInvite(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
