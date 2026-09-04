import type { Member } from "../gen/stoop/chat/v1/member_pb";

// Client-side mirror of the server's mention token rule.
const HANDLE = /^[a-z0-9_]{3,32}$/i;
export const MENTION_TOKEN = /(^|[^a-z0-9_@])@([a-z0-9_]{3,32})\b/gi;

// The @query being typed at the caret, if any: e.g. "hi @be|" → "be".
export function mentionQueryAt(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && /[a-z0-9_@]/i.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (!/^[a-z0-9_]*$/i.test(query)) return null;
  return { start: at, query };
}

export const EVERYONE = "everyone";
export const HERE = "here";

// Candidates for the picker: members matching the prefix, plus @everyone
// first when the caller may use it.
export function filterMembers(
  members: Member[],
  query: string,
  includeEveryone = false,
): Member[] {
  const q = query.toLowerCase();
  const out: Member[] = [];
  if (includeEveryone) {
    for (const [handle, label] of [
      [EVERYONE, "Everyone in this space"],
      [HERE, "Everyone online right now"],
    ]) {
      if (handle.startsWith(q)) {
        out.push({
          $typeName: "stoop.chat.v1.Member",
          userId: handle,
          username: handle,
          displayName: label,
          role: 0,
          instanceAdmin: false,
        } as Member);
      }
    }
  }
  for (const m of members) {
    if (
      m.username.toLowerCase().startsWith(q) ||
      m.displayName.toLowerCase().startsWith(q)
    ) {
      out.push(m);
    }
  }
  return out.slice(0, 8);
}

// Splits content into plain text and mention tokens (only for handles
// that are actually members, matching the server).
export function splitMentions(
  content: string,
  usernames: Set<string>,
  everyone = false,
  here = false,
): { text: string; mention?: string }[] {
  const out: { text: string; mention?: string }[] = [];
  let last = 0;
  for (const m of content.matchAll(MENTION_TOKEN)) {
    const handle = m[2];
    const lower = handle.toLowerCase();
    const isEveryone =
      (everyone && lower === EVERYONE) || (here && lower === HERE);
    if (!HANDLE.test(handle) || (!usernames.has(lower) && !isEveryone))
      continue;
    const tokenStart = (m.index ?? 0) + m[1].length;
    if (tokenStart > last) out.push({ text: content.slice(last, tokenStart) });
    out.push({ text: `@${handle}`, mention: handle.toLowerCase() });
    last = tokenStart + handle.length + 1;
  }
  if (last < content.length) out.push({ text: content.slice(last) });
  return out;
}
