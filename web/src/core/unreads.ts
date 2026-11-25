import type { Channel } from "../gen/stoop/chat/v1/channel_pb";
import type { Message } from "../gen/stoop/chat/v1/message_pb";

// Badge pills are narrow, and past a hundred the exact number stops
// telling you anything you'd act on.
export function badgeCount(n: number): string {
  return n > 99 ? "99+" : String(n);
}

// Whether a row is the reader's own send, which moved their read marker
// to it on the server: a row they authored, a poll and its closing row
// included. Not a delivered reminder (docs/architecture/messaging.md →
// Reminders): the server posts it in their name while they may be
// anywhere and moves nobody's marker, so for unread and read-marking it
// is a row from someone else. Every place that asks "did the reader just
// read up to here by posting" asks this; whether the row is quiet, or in
// a thread, is each caller's own question.
export function isOwnSend(
  message: Message,
  me: string | null | undefined,
): boolean {
  return (
    !!me && message.author?.id === me && message.event?.kind.case !== "reminder"
  );
}

// What a row arriving in a channel's timeline does to the reader's
// record of the channel, until the server's next answer: it is the
// newest message, read if it is the reader's own send or they are
// looking at the channel (reading), and one more unread otherwise.
export function withArrival(
  channel: Pick<Channel, "unreadCount">,
  message: Message,
  me: string | null | undefined,
  reading: boolean,
): Pick<Channel, "lastMessageId" | "unreadCount"> &
  Partial<Pick<Channel, "lastReadMessageId">> {
  return isOwnSend(message, me) || reading
    ? {
        lastMessageId: message.id,
        lastReadMessageId: message.id,
        unreadCount: 0,
      }
    : { lastMessageId: message.id, unreadCount: channel.unreadCount + 1 };
}

export function isUnread(c: Channel): boolean {
  return c.lastMessageId !== "" && c.lastMessageId > c.lastReadMessageId;
}
