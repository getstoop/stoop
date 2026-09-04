// Whether a member has already read a space's welcome text. Kept in this
// browser rather than the database: re-reading it on a new device costs
// one click, and the alternative is a per-member column and a mark RPC.
// The key carries a hash of the text, so a rewritten welcome is shown
// once more — which is what an admin rewriting the house rules wants.

const hash = (s: string): string => {
  // FNV-1a, 32-bit: short, stable, and not a security boundary.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
};

const key = (spaceId: string, text: string) =>
  `stoop:welcome:${spaceId}:${hash(text)}`;

// Storage can be unavailable (a locked-down browser, private mode). Then
// the welcome counts as read: better to skip it than to trap someone on
// a pane whose dismissal never sticks.
export function welcomeSeen(spaceId: string, text: string): boolean {
  try {
    return localStorage.getItem(key(spaceId, text)) !== null;
  } catch {
    return true;
  }
}

export function markWelcomeSeen(spaceId: string, text: string): void {
  try {
    localStorage.setItem(key(spaceId, text), "1");
  } catch {
    // Nothing to do: it will be offered again next time.
  }
}
