import type { Member } from "../../gen/stoop/chat/v1/member_pb";

// Offline members fold away by default once a space is big enough that
// the list is mostly people who are not here.
export const COLLAPSE_OFFLINE_ABOVE = 20;

export function memberName(m: Member): string {
  return m.displayName || m.username;
}

export function matches(m: Member, needle: string): boolean {
  return (
    m.username.toLowerCase().includes(needle) ||
    m.displayName.toLowerCase().includes(needle)
  );
}

// The two groups the panel shows, in the server's role order, narrowed
// to the search when there is one.
export function splitMembers(
  members: Member[],
  online: Set<string>,
  query: string,
): { online: Member[]; offline: Member[] } {
  const needle = query.trim().toLowerCase();
  const shown = needle ? members.filter((m) => matches(m, needle)) : members;
  return {
    online: shown.filter((m) => online.has(m.userId)),
    offline: shown.filter((m) => !online.has(m.userId)),
  };
}

// "5/48 online" at rest, "3 of 48 match" while searching.
export function headingText(
  total: number,
  onlineCount: number,
  shownCount: number,
  searching: boolean,
): string {
  if (searching) return `${shownCount} of ${total} match`;
  return `${onlineCount}/${total} online`;
}
