import type { Group } from "../gen/stoop/chat/v1/group_pb";
import type { Member } from "../gen/stoop/chat/v1/member_pb";
import { isBot } from "./identity";

// Only a token mentions anyone: <@u:ID:handle> a person, <@g:ID:handle> a
// group, the handle being the one current when it was saved. @channel and
// @here stay typed words. See docs/architecture/messaging.md → Mentions.

export type MentionKind = "person" | "group";

// What a mention is in the editor and in a parsed message.
export interface MentionRef {
  kind: MentionKind;
  id: string;
  handle: string;
}

const KIND_LETTER: Record<MentionKind, string> = { person: "u", group: "g" };

export const MENTION_TOKEN =
  /<@([ug]):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([a-z0-9_]{3,32})>/;

export function mentionToken({ kind, id, handle }: MentionRef): string {
  return `<@${KIND_LETTER[kind]}:${id}:${handle}>`;
}

// The token at the start of s, if any.
export function mentionTokenAt(
  s: string,
): { mention: MentionRef; length: number } | null {
  const match = new RegExp(`^${MENTION_TOKEN.source}`).exec(s);
  if (!match) return null;
  const [token, letter, id, handle] = match;
  const kind: MentionKind = letter === "g" ? "group" : "person";
  return { mention: { kind, id, handle }, length: token.length };
}

// Each token as the @handle it was written with. Mentions don't work in
// code, so code shows them this way.
export function tokensAsText(content: string): string {
  return content.replace(new RegExp(MENTION_TOKEN.source, "g"), "@$3");
}

// Content's length as people read it, each token counted as its handle:
// the message limit, as the server counts it.
export function writtenLength(content: string): number {
  return tokensAsText(content).length;
}

// The @query being typed at the caret, if any: e.g. "hi @be|" → "be".
export function mentionQueryAt(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  const query = before.slice(at + 1);
  if (!/^[a-z0-9_]*$/i.test(query)) return null;
  if (at > 0 && /[a-z0-9_@]/i.test(before[at - 1])) return null;
  return { start: at, query };
}

export const CHANNEL_HANDLE = "channel";
export const HERE_HANDLE = "here";

// The people a mention may name, by user ID.
export type MentionMembers = ReadonlyMap<string, Member>;

// The groups a mention may name, by ID; empty where groups do nothing (a
// private channel, a DM).
export type MentionGroups = ReadonlyMap<string, Group>;
export const NO_GROUPS: MentionGroups = new Map();
export const NO_MEMBERS: MentionMembers = new Map();

export function mentionGroups(groups: Group[] | undefined): MentionGroups {
  return new Map(groups?.map((group) => [group.id, group]));
}

export function mentionMembers(members: Member[] | undefined): MentionMembers {
  return new Map(members?.map((member) => [member.userId, member]));
}

export const isChannelOrHere = (handle: string) =>
  handle === CHANNEL_HANDLE || handle === HERE_HANDLE;

// The one person or group a fully typed handle names, or null when it
// names nobody or both a person and a group.
export function soleMention(
  handle: string,
  members: MentionMembers,
  groups: MentionGroups,
): MentionRef | null {
  const lower = handle.toLowerCase();
  if (isChannelOrHere(lower)) return null;
  const found: MentionRef[] = [];
  for (const member of members.values()) {
    if (member.username.toLowerCase() === lower) {
      found.push({ kind: "person", id: member.userId, handle: lower });
    }
  }
  for (const group of groups.values()) {
    if (group.handle === lower) {
      found.push({ kind: "group", id: group.id, handle: lower });
    }
  }
  return found.length === 1 ? found[0] : null;
}

// The handle a mention reads as now: the person's or group's current one,
// or null when neither can be found here.
export function currentHandle(
  mention: MentionRef,
  members: MentionMembers,
  groups: MentionGroups,
): string | null {
  if (mention.kind === "group") return groups.get(mention.id)?.handle ?? null;
  return members.get(mention.id)?.username.toLowerCase() ?? null;
}

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

export type EveryonePart = { text: string; everyone?: true };

const EVERYONE_WORD = /(^|[^a-z0-9_@])@(channel|here)\b/gi;

// Splits text into plain runs and the @channel / @here the message used.
export function splitEveryone(
  text: string,
  entireChannel = false,
  here = false,
): EveryonePart[] {
  const out: EveryonePart[] = [];
  let last = 0;
  for (const match of text.matchAll(EVERYONE_WORD)) {
    const [, lead, word] = match;
    const lower = word.toLowerCase();
    if (
      !(entireChannel && lower === CHANNEL_HANDLE) &&
      !(here && lower === HERE_HANDLE)
    ) {
      continue;
    }
    const start = (match.index ?? 0) + lead.length;
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push({ text: `@${word}`, everyone: true });
    last = start + word.length + 1;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

// A picker row: someone (or @channel / @here), or a group.
export type MentionCandidate =
  | { kind: "member"; member: Member }
  | { kind: "group"; group: Group };

// The picker's rows for what is being typed: @channel and @here, then
// groups, then people.
export function mentionCandidates(
  members: Member[],
  groups: Group[],
  query: string,
  { channelAndHere = false } = {},
): MentionCandidate[] {
  const q = query.toLowerCase();
  const people = filterMembers(members, query, channelAndHere);
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

// The mention picking a row makes, or null for @channel and @here, which
// are typed words.
export function candidateMention(
  candidate: MentionCandidate,
): MentionRef | null {
  if (candidate.kind === "group") {
    const { id, handle } = candidate.group;
    return { kind: "group", id, handle };
  }
  const { userId, username } = candidate.member;
  if (isChannelOrHere(userId)) return null;
  return { kind: "person", id: userId, handle: username.toLowerCase() };
}

// A person's pill: a person or bot glyph, and the accent fill when it is us.
export function mentionClass(member: Member | undefined, myUserId?: string) {
  const glyph = isBot(member?.kind) ? "bot" : "person";
  const mine = myUserId && member?.userId === myUserId ? "me" : "";
  return ["mention", glyph, mine].filter(Boolean).join(" ");
}

// @channel and @here: the accent fill, since they reach us too.
export const EVERYONE_CLASS = "mention me";

// A group's pill: the group glyph, and the accent fill when we're in it.
export function groupMentionClass(group: Group | undefined, myUserId?: string) {
  const mine = !!myUserId && !!group?.userIds.includes(myUserId);
  return mine ? "mention group me" : "mention group";
}
