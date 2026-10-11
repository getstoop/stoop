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

export const CHANNEL = "channel";
export const HERE = "here";
// Messages from before @channel replaced it still carry this one.
export const EVERYONE = "everyone";

// Candidates for the picker: members matching the prefix, plus @channel
// and @here first when the caller may use them.
export function filterMembers(
  members: Member[],
  query: string,
  includeBroadcast = false,
): Member[] {
  const q = query.toLowerCase();
  const out: Member[] = [];
  if (includeBroadcast) {
    for (const [handle, label] of [
      [CHANNEL, "Everyone in this channel"],
      [HERE, "Everyone here who is online"],
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
  channel = false,
): { text: string; mention?: string }[] {
  const out: { text: string; mention?: string }[] = [];
  let last = 0;
  for (const m of content.matchAll(MENTION_TOKEN)) {
    const handle = m[2];
    const lower = handle.toLowerCase();
    const isBroadcast =
      (everyone && lower === EVERYONE) ||
      (here && lower === HERE) ||
      (channel && lower === CHANNEL);
    if (!HANDLE.test(handle) || (!usernames.has(lower) && !isBroadcast))
      continue;
    const tokenStart = (m.index ?? 0) + m[1].length;
    if (tokenStart > last) out.push({ text: content.slice(last, tokenStart) });
    out.push({ text: `@${handle}`, mention: handle.toLowerCase() });
    last = tokenStart + handle.length + 1;
  }
  if (last < content.length) out.push({ text: content.slice(last) });
  return out;
}

// What the picker says beside a row in a text channel: how many other
// people @channel and @here reach, and that naming someone outside the
// channel brings them in. Keyed by the row's userId.
export function mentionNotes(
  candidates: Member[],
  channelName: string,
  inside: Set<string>,
  online: Set<string>,
  me: string,
): Map<string, string> {
  const people = (count: number) =>
    count === 1 ? "1 person" : `${count} people`;
  const notes = new Map<string, string>();
  for (const candidate of candidates) {
    if (candidate.userId === CHANNEL) {
      notes.set(CHANNEL, people(inside.size - (inside.has(me) ? 1 : 0)));
    } else if (candidate.userId === HERE) {
      let here = 0;
      for (const id of inside) if (id !== me && online.has(id)) here += 1;
      notes.set(HERE, people(here));
    } else if (candidate.userId !== me && !inside.has(candidate.userId)) {
      notes.set(candidate.userId, `Not in #${channelName}, will be added`);
    }
  }
  return notes;
}
