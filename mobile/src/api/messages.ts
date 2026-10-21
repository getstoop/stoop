import type { Channel } from "@stoop/gen/stoop/chat/v1/channel_pb";
import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";
import type { ServerEvent } from "@stoop/gen/stoop/realtime/v1/realtime_pb";
import { withMessage, withoutMessage, withReactions, withReplaced, withRootDeleted } from "@stoop/core/messageList";
import { authClient, chatClient } from "./clients";

// A channel's screen: the channel and its space for the title, how many
// people can read it, who is reading (for the "New" line and what
// mentions them), and the newest page of its messages. Older pages load
// as the reader scrolls up; realtime events keep the newest end current.

export type ChannelView = {
  space: Space;
  channel: Channel;
  // The space's members, or a private channel's.
  memberCount: number;
  myUserId: string;
  // Oldest first.
  messages: Message[];
  hasOlder: boolean;
};

const TIMEOUT_MS = 10000;
const PAGE = 50;

// The channel's not being in the space's list means it was deleted, or
// the reader can no longer see it.
export class ChannelGone extends Error {}

export async function loadChannel(
  origin: string,
  token: string,
  spaceId: string,
  channelId: string,
): Promise<ChannelView> {
  const chat = chatClient(origin, token);
  const options = { timeoutMs: TIMEOUT_MS };
  const [{ space }, { channels }, { user }, page] = await Promise.all([
    chat.getSpace({ spaceId }, options),
    chat.listChannels({ spaceId }, options),
    authClient(origin, token).getMe({}, options),
    chat.listMessages({ channelId, limit: PAGE }, options),
  ]);
  const channel = channels.find((candidate) => candidate.id === channelId);
  if (!space || !user) throw new Error("The server answered with nothing.");
  if (!channel) throw new ChannelGone();
  const memberCount = channel.private
    ? (await chat.listChannelMembers({ channelId }, options)).userIds.length
    : (await chat.listMembers({ spaceId }, options)).members.length;
  return {
    space,
    channel,
    memberCount,
    myUserId: user.id,
    messages: page.messages,
    hasOlder: page.hasOlder,
  };
}

// The page before the oldest message held.
export async function loadOlder(
  origin: string,
  token: string,
  channelId: string,
  beforeId: string,
): Promise<Window> {
  const page = await chatClient(origin, token).listMessages(
    { channelId, beforeId, limit: PAGE },
    { timeoutMs: TIMEOUT_MS },
  );
  return { messages: page.messages, hasOlder: page.hasOlder };
}

// Moves the reader's marker in the channel up to messageId.
export async function markRead(origin: string, token: string, channelId: string, messageId: string): Promise<void> {
  await chatClient(origin, token).markChannelRead({ channelId, messageId }, { timeoutMs: TIMEOUT_MS });
}

// After a reconnect, when events may have been missed: the newest page
// in place of the newest end of what is held. History paged in above it
// stays when the page reaches back into it; when the page doesn't (a long
// time away), the page alone, since a gap would read as nothing having
// been said.
export type Window = { messages: Message[]; hasOlder: boolean };

export function withNewestPage(held: Window, page: Window): Window {
  const oldest = page.messages[0];
  const join = oldest ? held.messages.findIndex((message) => message.id >= oldest.id) : -1;
  if (join <= 0) return page;
  return { messages: [...held.messages.slice(0, join), ...page.messages], hasOlder: held.hasOlder };
}

// What a realtime event does to the channel's messages, by web's rules
// (core/messageList): the same list when it is about something else. A
// reply that stays in its thread is not in the channel's timeline.
export function withChannelEvent(messages: Message[], event: ServerEvent, channelId: string): Message[] {
  const payload = event.payload;
  switch (payload.case) {
    case "messageCreated": {
      const message = payload.value;
      if (message.channelId !== channelId || (message.threadRootId && !message.inChannel)) return messages;
      return withMessage(messages, message);
    }
    case "messageUpdated": {
      const message = payload.value;
      if (message.channelId !== channelId) return messages;
      const replaced = withReplaced(messages, message);
      return message.deleted ? withRootDeleted(replaced, message.id) : replaced;
    }
    case "messageDeleted":
      if (payload.value.channelId !== channelId) return messages;
      return withoutMessage(messages, payload.value.messageId);
    case "reactionsChanged":
      if (payload.value.channelId !== channelId) return messages;
      return withReactions(messages, payload.value.messageId, payload.value.reactions);
    default:
      return messages;
  }
}

// Whether an event means the reader can no longer see the channel: it, or
// its space, was deleted, or they were taken out of either.
export function losesChannel(event: ServerEvent, spaceId: string, channelId: string, myUserId: string): boolean {
  const payload = event.payload;
  switch (payload.case) {
    case "channelDeleted":
      return payload.value.channelId === channelId;
    case "spaceDeleted":
      return payload.value.spaceId === spaceId;
    case "memberRemoved":
      return payload.value.spaceId === spaceId && payload.value.userId === myUserId;
    case "channelMemberLeft":
      return payload.value.channelId === channelId && payload.value.userId === myUserId;
    default:
      return false;
  }
}

// Whether a message mentions the reader, so its row is tinted: by name,
// in a group they are in, with @channel (all resolved by the server into
// mention_user_ids), or with @here, which reaches whoever is online.
export function mentionsMe(message: Message, myUserId: string): boolean {
  if (message.author?.id === myUserId) return false;
  return message.mentionsHere || message.mentionUserIds.includes(myUserId);
}
