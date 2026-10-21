import type { Message } from "../gen/stoop/chat/v1/message_pb";
import type { ServerEvent } from "../gen/stoop/realtime/v1/realtime_pb";
import {
  withMessage,
  withoutMessage,
  withReactions,
  withReplaced,
  withRootDeleted,
} from "./messageList";

// A channel's window of messages, and what a reconnect and a realtime
// event do to it (the timeline reducer, core/timelineState, runs these).

// A run of a channel's messages, oldest first, whether more lie above, and
// whether more lie below: absent or false, it reaches the newest message.
export type Page = {
  messages: Message[];
  hasOlder: boolean;
  hasNewer?: boolean;
};

// After a reconnect, when events may have been missed: the newest page in
// place of the newest end of what is held. History paged in above it stays
// when the page reaches back into it; when the page doesn't (a long time
// away), the page alone, since a gap would read as nothing having been
// said.
export function withNewestPage(held: Page, page: Page): Page {
  const oldest = page.messages[0];
  const join = oldest
    ? held.messages.findIndex((message) => message.id >= oldest.id)
    : -1;
  if (join <= 0) return page;
  return {
    messages: [...held.messages.slice(0, join), ...page.messages],
    hasOlder: held.hasOlder,
  };
}

// What a realtime event does to the channel's messages, or with rootId to
// one thread's replies, by web's rules (messageList): the same list when
// it is about something else. A reply that stays in its thread is not in
// the channel's timeline. Applying an event a second time changes
// nothing, so events that arrived during a load can be replayed over its
// result.
export function withChannelEvent(
  messages: Message[],
  event: ServerEvent,
  channelId: string,
  rootId?: string,
): Message[] {
  const payload = event.payload;
  switch (payload.case) {
    case "messageCreated": {
      const message = payload.value;
      const shows = rootId
        ? message.threadRootId === rootId
        : !message.threadRootId || message.inChannel;
      if (message.channelId !== channelId || !shows) return messages;
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
      return withReactions(
        messages,
        payload.value.messageId,
        payload.value.reactions,
      );
    default:
      return messages;
  }
}

// Whether an event means the reader can no longer see the channel: it, or
// its space, was deleted, or they were taken out of either.
export function losesChannel(
  event: ServerEvent,
  spaceId: string,
  channelId: string,
  myUserId: string,
): boolean {
  const payload = event.payload;
  switch (payload.case) {
    case "channelDeleted":
      return payload.value.channelId === channelId;
    case "spaceDeleted":
      return payload.value.spaceId === spaceId;
    case "memberRemoved":
      return (
        payload.value.spaceId === spaceId && payload.value.userId === myUserId
      );
    case "channelMemberLeft":
      return (
        payload.value.channelId === channelId &&
        payload.value.userId === myUserId
      );
    default:
      return false;
  }
}

// Whether a message mentions the reader, so its row is tinted: by name, in
// a group they are in, with @channel (all resolved by the server into
// mention_user_ids), or with @here, which reaches whoever is online.
export function mentionsMe(message: Message, myUserId: string): boolean {
  if (message.author?.id === myUserId) return false;
  return message.mentionsHere || message.mentionUserIds.includes(myUserId);
}
