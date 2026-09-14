import { isBot } from "../../api/identity";
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

// The three groups the panel shows, in the server's role order, narrowed
// to the search when there is one. A bot is never online: it holds no
// socket, so it gets its own group rather than sitting with the people
// who went to bed.
export function splitMembers(
  members: Member[],
  online: Set<string>,
  query: string,
): { online: Member[]; offline: Member[]; bots: Member[] } {
  const needle = query.trim().toLowerCase();
  const shown = needle ? members.filter((m) => matches(m, needle)) : members;
  const people = shown.filter((m) => !isBot(m.kind));
  return {
    online: people.filter((m) => online.has(m.userId)),
    offline: people.filter((m) => !online.has(m.userId)),
    bots: shown.filter((m) => isBot(m.kind)),
  };
}

// "5/48 online" at rest, counting people; "3 of 48 match" while
// searching, counting everyone.
export function headingText(
  total: number,
  onlineCount: number,
  shownCount: number,
  searching: boolean,
): string {
  if (searching) return `${shownCount} of ${total} match`;
  return `${onlineCount}/${total} online`;
}
