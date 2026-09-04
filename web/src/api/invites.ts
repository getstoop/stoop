// Helpers shared by the invite modal and the join flows.

// Accepts a bare code, a pasted /join/<code> link, or either with stray
// whitespace, and returns just the code.
export function parseInviteCode(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/join\/([^/?#\s]+)/);
  return (match ? match[1] : trimmed).trim();
}

// Display-only hint so /join can name the space in its "Joining …" line
// without waiting on a lookup. It's untrusted and may be absent (older
// or hand-edited links), so readers must fall back gracefully — the
// login landing asks the server instead (LookupInvite).
const MAX_SPACE_HINT = 100;

// origin is the server's configured public address when it has one, so
// an admin on the LAN doesn't hand out a link that only works on the LAN.
export function inviteLink(
  code: string,
  spaceName?: string,
  origin: string = location.origin,
): string {
  const url = new URL(`/join/${code}`, origin || location.origin);
  if (spaceName)
    url.searchParams.set("space", spaceName.slice(0, MAX_SPACE_HINT));
  return url.toString();
}
