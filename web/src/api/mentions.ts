import type { Member } from "../gen/stoop/chat/v1/member_pb";
import { isBot } from "./identity";

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

export const CHANNEL_HANDLE = "channel";
export const HERE_HANDLE = "here";

// The member each handle names.
export type MentionMembers = ReadonlyMap<string, Member>;

export function mentionMembers(members: Member[] | undefined): MentionMembers {
  return new Map(members?.map((m) => [m.username.toLowerCase(), m]));
}

export const isChannelOrHere = (handle: string) =>
  handle === CHANNEL_HANDLE || handle === HERE_HANDLE;

// Candidates for the picker: members matching the prefix, plus @channel
// first when the caller may use it.
export function filterMembers(
  members: Member[],
  query: string,
  includeChannelAndHere = false,
): Member[] {
  const q = query.toLowerCase();
  const out: Member[] = [];
  if (includeChannelAndHere) {
    for (const [handle, label] of [
      [CHANNEL_HANDLE, "Everyone in this channel"],
      [HERE_HANDLE, "Everyone online in this channel"],
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
  usernames: { has(handle: string): boolean },
  entireChannel = false,
  here = false,
): { text: string; mention?: string }[] {
  const out: { text: string; mention?: string }[] = [];
  let last = 0;
  for (const m of content.matchAll(MENTION_TOKEN)) {
    const handle = m[2];
    const lower = handle.toLowerCase();
    const isChannelOrHere =
      (entireChannel && lower === CHANNEL_HANDLE) ||
      (here && lower === HERE_HANDLE);
    if (!HANDLE.test(handle) || (!usernames.has(lower) && !isChannelOrHere))
      continue;
    const tokenStart = (m.index ?? 0) + m[1].length;
    if (tokenStart > last) out.push({ text: content.slice(last, tokenStart) });
    out.push({ text: `@${handle}`, mention: handle.toLowerCase() });
    last = tokenStart + handle.length + 1;
  }
  if (last < content.length) out.push({ text: content.slice(last) });
  return out;
}

// A mention's pill: a person or bot glyph after a member's handle, and
// the accent fill when it reaches us.
export function mentionClass(
  handle: string,
  members: MentionMembers,
  me?: string,
): string {
  const everyone = isChannelOrHere(handle);
  const glyph = everyone
    ? ""
    : isBot(members.get(handle)?.kind)
      ? "bot"
      : "person";
  const mine = me && (handle === me || everyone) ? "me" : "";
  return ["mention", glyph, mine].filter(Boolean).join(" ");
}
