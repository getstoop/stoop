import { type Channel, ChannelKind } from "../gen/stoop/chat/v1/channel_pb";
import type { Group } from "../gen/stoop/chat/v1/group_pb";
import type { Member } from "../gen/stoop/chat/v1/member_pb";
import type { Message } from "../gen/stoop/chat/v1/message_pb";

// Only a token mentions anyone: <@u:ID:handle> a person, <@g:ID:handle> a
// group, the handle being the one current when it was saved. @channel and
// @here stay typed words. <#ID:name> links a channel: it rides the same
// machinery but tells nobody. See docs/architecture/messaging.md →
// Mentions and Channel links.

type MentionKind = "person" | "group" | "channel";

// What a mention or a channel link is in the editor and in a parsed
// message. A channel's handle is its name.
export interface MentionRef {
  kind: MentionKind;
  id: string;
  handle: string;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const MENTION_TOKEN = new RegExp(
  `<@([ug]):(${UUID}):([a-z0-9_]{3,32})>|<#(${UUID}):([a-z0-9_-]{1,32})>`,
);

export function mentionToken({ kind, id, handle }: MentionRef): string {
  if (kind === "channel") return `<#${id}:${handle}>`;
  return `<@${kind === "group" ? "g" : "u"}:${id}:${handle}>`;
}

// How a mention reads as words: @handle, or #name for a channel.
export const mentionText = ({ kind, handle }: MentionRef) =>
  `${kind === "channel" ? "#" : "@"}${handle}`;

function refOf(match: RegExpExecArray): MentionRef {
  const [, letter, id, handle, channelId, name] = match;
  if (channelId) return { kind: "channel", id: channelId, handle: name };
  return { kind: letter === "g" ? "group" : "person", id, handle };
}

// The token at the start of s, if any.
export function mentionTokenAt(
  s: string,
): { mention: MentionRef; length: number } | null {
  const match = new RegExp(`^(?:${MENTION_TOKEN.source})`).exec(s);
  if (!match) return null;
  return { mention: refOf(match), length: match[0].length };
}

// Each token as the @handle or #name it was written with. Mentions don't
// work in code, so code shows them this way.
export function tokensAsText(content: string): string {
  return content.replace(new RegExp(MENTION_TOKEN.source, "g"), (...match) =>
    mentionText(refOf(match as unknown as RegExpExecArray)),
  );
}

// Content's length as people read it, each token counted as its handle
// and each character (code point, not UTF-16 unit) once: the message
// limit, as the server counts it.
export function writtenLength(content: string): number {
  let count = 0;
  for (const _ of tokensAsText(content)) count++;
  return count;
}

// The server's limit on writtenLength (internal/chat maxMessageLen; the
// shared cases check the two agree).
export const MAX_MESSAGE_LENGTH = 4000;

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

const CHANNEL_HANDLE = "channel";
const HERE_HANDLE = "here";

// The #query being typed at the caret, if any: e.g. "see #gar|" → "gar".
// Not after a letter, a digit, "#", "&" or "/" (C#, &#39;, an address),
// nor anywhere in an address (https://a.example/?#top).
export function channelQueryAt(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const hash = before.lastIndexOf("#");
  if (hash < 0) return null;
  const query = before.slice(hash + 1);
  if (!/^[a-z0-9_-]*$/i.test(query)) return null;
  if (hash > 0 && /[a-z0-9_#&/]/i.test(before[hash - 1])) return null;
  if (/:\/\/\S*$/.test(before.slice(0, hash))) return null;
  return { start: hash, query };
}

// The people a mention may name, by user ID.
export type MentionMembers = ReadonlyMap<string, Member>;

// The groups a mention may name, by ID; empty where groups do nothing (a
// private channel, a DM).
export type MentionGroups = ReadonlyMap<string, Group>;
export const NO_GROUPS: MentionGroups = new Map();
export const NO_MEMBERS: MentionMembers = new Map();

// The channels a link may name, by ID: the space's public text channels
// whose names a token can carry (one saved before the naming rule can't).
// Empty in a private channel or a DM, whose links the server keeps as text.
export type MentionChannels = ReadonlyMap<string, Channel>;
export const NO_CHANNELS: MentionChannels = new Map();

const TOKEN_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;

const linkable = (channel: Channel) =>
  !channel.private &&
  channel.kind === ChannelKind.TEXT &&
  TOKEN_NAME.test(channel.name);

export function linkableChannels(
  channels: Channel[] | undefined,
): MentionChannels {
  return new Map(
    channels?.filter(linkable).map((channel) => [channel.id, channel]),
  );
}

// The channels after one was made or changed: in while it is linkable,
// out once it isn't. The same map when that changes nothing.
export function withLinkableChannel(
  channels: MentionChannels,
  channel: Channel,
): MentionChannels {
  if (linkable(channel)) return new Map(channels).set(channel.id, channel);
  return withoutChannel(channels, channel.id);
}

// The channels after one was deleted.
export function withoutChannel(
  channels: MentionChannels,
  channelId: string,
): MentionChannels {
  if (!channels.has(channelId)) return channels;
  const out = new Map(channels);
  out.delete(channelId);
  return out;
}

// The channel a fully typed #name names, if any.
export function soleChannel(
  name: string,
  channels: MentionChannels,
): MentionRef | null {
  const lower = name.toLowerCase();
  for (const channel of channels.values()) {
    if (channel.name === lower) {
      return { kind: "channel", id: channel.id, handle: lower };
    }
  }
  return null;
}

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

// "@handle" with something after it that can't be part of a handle, or
// nothing after it: the handle is typed in full. Not after a letter, a
// digit or another "@".
export const TYPED_HANDLE =
  /(^|[^a-z0-9_@])@([a-z0-9_]{3,32})(?=[^a-z0-9_]|$)/gi;
// "#name" the same way, not after what channelQueryAt skips.
export const TYPED_CHANNEL =
  /(^|[^a-z0-9_#&/])#([a-z0-9][a-z0-9_-]{0,31})(?=[^a-z0-9_-]|$)/gi;
export const ADDRESS = /https?:\/\/[^\s<>]+/gi;

// Who and what a typed handle may name.
export interface MentionNames {
  members: MentionMembers;
  groups: MentionGroups;
  channels: MentionChannels;
}

// Text with each @handle or #name typed in full that exactly one person,
// group or channel has written as its token, as web's editor turns one
// into a pill: the phone's plain field on send. Web addresses, @channel
// and @here are left as they are, and so are tokens already there, which
// the patterns can't match into (an "@" is followed by a one-letter kind,
// a "#" by an ID too long for a name). Code, spoilers and links' words
// are not told apart: a token there is saved as text by the server.
export function withTypedMentions(
  text: string,
  { members, groups, channels }: MentionNames,
): string {
  const addresses = [...text.matchAll(ADDRESS)].map((match) => [
    match.index,
    match.index + match[0].length,
  ]);
  const typed = [
    ...[...text.matchAll(TYPED_HANDLE)].map((match) => ({
      match,
      ref: soleMention(match[2], members, groups),
    })),
    ...[...text.matchAll(TYPED_CHANNEL)].map((match) => ({
      match,
      ref: soleChannel(match[2], channels),
    })),
  ];
  const replacements: { start: number; end: number; ref: MentionRef }[] = [];
  for (const { match, ref } of typed) {
    if (!ref) continue;
    const start = match.index + match[1].length;
    if (addresses.some(([from, to]) => start >= from && start < to)) continue;
    replacements.push({ start, end: start + match[2].length + 1, ref });
  }
  replacements.sort((a, b) => a.start - b.start);
  let out = "";
  let last = 0;
  for (const { start, end, ref } of replacements) {
    out += text.slice(last, start) + mentionToken(ref);
    last = end;
  }
  return out + text.slice(last);
}

// The handle a mention reads as now: the person's, group's or channel's
// current one, or null when it can't be found here.
export function currentHandle(
  mention: MentionRef,
  members: MentionMembers,
  groups: MentionGroups,
  channels: MentionChannels = NO_CHANNELS,
): string | null {
  if (mention.kind === "channel") {
    return channels.get(mention.id)?.name ?? null;
  }
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

type EveryonePart = { text: string; everyone?: true };

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

// A picker row: someone (or @channel / @here), a group, or a channel to
// link.
export type MentionCandidate =
  | { kind: "member"; member: Member }
  | { kind: "group"; group: Group }
  | { kind: "channel"; channel: Channel };

// The picker's rows for a #query: channels whose name starts with it, in
// the sidebar's order.
export function channelCandidates(
  channels: MentionChannels,
  query: string,
): MentionCandidate[] {
  const q = query.toLowerCase();
  return [...channels.values()]
    .filter((channel) => channel.name.startsWith(q))
    .slice(0, 8)
    .map((channel) => ({ kind: "channel", channel }));
}

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
  if (candidate.kind === "channel") {
    const { id, name } = candidate.channel;
    return { kind: "channel", id, handle: name };
  }
  if (candidate.kind === "group") {
    const { id, handle } = candidate.group;
    return { kind: "group", id, handle };
  }
  const { userId, username } = candidate.member;
  if (isChannelOrHere(userId)) return null;
  return { kind: "person", id: userId, handle: username.toLowerCase() };
}

// Whether a message mentions the reader, so its row is tinted: by name, in
// a group they are in, with @channel (all resolved by the server into
// mention_user_ids), or with @here, which reaches whoever is online.
export function mentionsMe(message: Message, myUserId: string): boolean {
  if (message.author?.id === myUserId) return false;
  return message.mentionsHere || message.mentionUserIds.includes(myUserId);
}
