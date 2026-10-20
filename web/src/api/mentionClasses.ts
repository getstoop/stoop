import { isBot } from "../core/identity";
import type { Group } from "../gen/stoop/chat/v1/group_pb";
import type { Member } from "../gen/stoop/chat/v1/member_pb";

// The class names a mention's pill wears, in a message (MessageBody) and
// in the editor (RichEditor). Web's half of mentions: what a mention is
// and how it parses is shared with the app in core/mentions.ts.

// A person's pill: a person or bot glyph, and the accent fill when it is us.
export function mentionClass(member: Member | undefined, myUserId?: string) {
  const glyph = isBot(member?.kind) ? "bot" : "person";
  const mine = myUserId && member?.userId === myUserId ? "me" : "";
  return ["mention", glyph, mine].filter(Boolean).join(" ");
}

// A channel link's pill: its #name says what it is, so it has no glyph.
export const CHANNEL_LINK_CLASS = "mention channel-pill";

// @channel and @here: the accent fill, since they reach us too.
export const EVERYONE_CLASS = "mention me";

// A group's pill: the group glyph, and the accent fill when we're in it.
export function groupMentionClass(group: Group | undefined, myUserId?: string) {
  const mine = !!myUserId && !!group?.userIds.includes(myUserId);
  return mine ? "mention group me" : "mention group";
}
