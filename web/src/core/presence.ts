// How someone's presence is drawn, for web's dots and the mobile app's:
// whether they are online, on do not disturb, or online only in a mobile
// app, as the realtime socket reports it (Ready.presences, then
// PresenceChanged). docs/architecture/realtime.md.

// The dot's modifier: an empty ring, a filled dot, a small phone for
// someone online only in a mobile app, or a dot with a bar through it
// (web: styles/presence.css; mobile: components/PresenceDot). Offline
// beats do not disturb, which beats mobile: the dot is first whether they
// can be reached, then whether they want to be.
export function presenceClass(
  online: boolean,
  dnd: boolean | undefined,
  mobile?: boolean,
): "offline" | "dnd" | "mobile" | "online" {
  if (!online) return "offline";
  if (dnd) return "dnd";
  return mobile ? "mobile" : "online";
}

// The dot's accessible name. Nothing on screen says "mobile": the phone
// shape does, and this is how a screen reader hears it.
export function presenceLabel(
  online: boolean,
  dnd: boolean | undefined,
  mobile?: boolean,
): string {
  if (!online) return "offline";
  if (dnd) return "do not disturb";
  return mobile ? "online on mobile" : "online";
}
