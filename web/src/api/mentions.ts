import type { Group } from "../gen/stoop/chat/v1/group_pb";
import type { Member } from "../gen/stoop/chat/v1/member_pb";
import { isBot } from "./identity";

// Client-side mirror of the server's mention token rules: @handle is a
// person, @@handle a group, and neither follows a letter or another @.
const HANDLE = /^[a-z0-9_]{3,32}$/i;
const MENTION_TOKEN = /(^|[^a-z0-9_@])(@@?)([a-z0-9_]{3,32})\b/gi;

// The @query or @@query being typed at the caret, if any: e.g.
// "hi @be|" → "be", "hi @@ga|" → "ga" for a group.
export function mentionQueryAt(
  text: string,
  caret: number,
): { start: number; query: string; group?: true } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  const query = before.slice(at + 1);
  if (!/^[a-z0-9_]*$/i.test(query)) return null;
  const group = at > 0 && before[at - 1] === "@";
  const start = group ? at - 1 : at;
  if (start > 0 && /[a-z0-9_@]/i.test(before[start - 1])) return null;
  return group ? { start, query, group } : { start, query };
}

export const CHANNEL_HANDLE = "channel";
export const HERE_HANDLE = "here";

// The member each handle names.
export type MentionMembers = ReadonlyMap<string, Member>;

// The group each @@handle names; empty where groups do nothing (a private
// channel, a DM).
export type MentionGroups = ReadonlyMap<string, Group>;
export const NO_GROUPS: MentionGroups = new Map();

export function mentionGroups(groups: Group[] | undefined): MentionGroups {
  return new Map(groups?.map((group) => [group.handle, group]));
}

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

export type MentionPart = { text: string; mention?: string; group?: true };

// Splits content into plain text and mention tokens (only for handles
// that are actually members, or groups, matching the server).
export function splitMentions(
  content: string,
  usernames: { has(handle: string): boolean },
  entireChannel = false,
  here = false,
  groups: { has(handle: string): boolean } = NO_GROUPS,
): MentionPart[] {
  const out: MentionPart[] = [];
  let last = 0;
  for (const match of content.matchAll(MENTION_TOKEN)) {
    const [, lead, sigil, handle] = match;
    const lower = handle.toLowerCase();
    const group = sigil === "@@";
    const isChannelOrHere =
      !group &&
      ((entireChannel && lower === CHANNEL_HANDLE) ||
        (here && lower === HERE_HANDLE));
    const known = group ? groups.has(lower) : usernames.has(lower);
    if (!HANDLE.test(handle) || (!known && !isChannelOrHere)) continue;
    const tokenStart = (match.index ?? 0) + lead.length;
    if (tokenStart > last) out.push({ text: content.slice(last, tokenStart) });
    const text = `${sigil}${handle}`;
    out.push(
      group ? { text, mention: lower, group } : { text, mention: lower },
    );
    last = tokenStart + text.length;
  }
  if (last < content.length) out.push({ text: content.slice(last) });
  return out;
}

// A picker row: someone (or @channel / @here), or a group.
export type MentionCandidate =
  | { kind: "member"; member: Member }
  | { kind: "group"; group: Group };

// The picker's rows for what is being typed: @channel and @here, then
// groups, then people. Typing @@ asks for groups alone.
export function mentionCandidates(
  members: Member[],
  groups: Group[],
  query: string,
  { channelAndHere = false, groupsOnly = false } = {},
): MentionCandidate[] {
  const q = query.toLowerCase();
  const people = groupsOnly
    ? []
    : filterMembers(members, query, channelAndHere);
  const asMember = (member: Member): MentionCandidate => ({
    kind: "member",
    member,
  });
  const matching = groups.filter(
    (group) =>
      group.handle.startsWith(q) || group.name.toLowerCase().startsWith(q),
  );
  return [
    ...people.filter((member) => isChannelOrHere(member.userId)).map(asMember),
    ...matching.map((group): MentionCandidate => ({ kind: "group", group })),
    ...people.filter((member) => !isChannelOrHere(member.userId)).map(asMember),
  ].slice(0, 8);
}

// What picking a row writes, with the space after it.
export const candidateText = (candidate: MentionCandidate) =>
  candidate.kind === "group"
    ? `@@${candidate.group.handle} `
    : `@${candidate.member.username} `;

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

// A group's pill: the group glyph, and the accent fill when we're in it.
export function groupMentionClass(group: Group | undefined, myUserId?: string) {
  const mine = !!myUserId && !!group?.userIds.includes(myUserId);
  return mine ? "mention group me" : "mention group";
}
