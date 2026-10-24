import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Message } from "../gen/stoop/chat/v1/message_pb";
import { dayLabel, sameDay } from "./dates";

// A day separator goes above the first message of each calendar day.
export const startsDay = (m: Message, prev: Message | undefined) =>
  !prev?.createdAt ||
  !m.createdAt ||
  !sameDay(timestampDate(prev.createdAt), timestampDate(m.createdAt));

// Where the "New messages" line goes: above the first message after the
// read marker as it was when the channel opened, skipping the reader's
// own (sending one is reading up to it). None when afterId is null.
export const firstNewMessageId = (
  messages: Message[],
  afterId: string | null,
  myUserId: string | undefined,
) =>
  afterId === null
    ? undefined
    : messages.find(
        (message) => message.id > afterId && message.author?.id !== myUserId,
      )?.id;

// A message continues the previous one when it's from the same author
// within the same minute, isn't a reply, and doesn't sit at the "New
// messages" line — then we skip its author/time row. Not after a deleted
// root's placeholder or a thread's summary line, and not for a placeholder
// or (in the channel) a reply also sent there, which draw lines of their own.
export const continues = (
  m: Message,
  prev: Message | undefined,
  firstNewId: string | undefined,
  inThread: boolean,
) =>
  !!prev &&
  prev.author?.id === m.author?.id &&
  !m.replyTo &&
  !m.deleted &&
  !prev.deleted &&
  !prev.thread &&
  !(m.threadRoot && !inThread) &&
  m.id !== firstNewId &&
  !!m.createdAt &&
  !!prev.createdAt &&
  sameMinute(timestampDate(prev.createdAt), timestampDate(m.createdAt));

export function sameMinute(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate() &&
    a.getHours() === b.getHours() &&
    a.getMinutes() === b.getMinutes()
  );
}

// A channel's rows for a list, oldest first: each message, a day line
// above the first of each day, and the "New" line above the first message
// after the read marker as it was on opening (null for no "New" line). The
// mobile app's channel screen draws these; web's list has a form of its
// own with a thread's rules (routes/Channel/MessageList/items.ts).
export type GroupedRow =
  | { kind: "message"; key: string; message: Message; continued: boolean }
  | { kind: "day" | "new"; key: string; label: string };

export function groupedRows(
  messages: Message[],
  newAfter: string | null,
  myUserId: string,
  now: Date = new Date(),
): GroupedRow[] {
  const firstNew = firstNewMessageId(messages, newAfter, myUserId);
  const rows: GroupedRow[] = [];
  messages.forEach((message, index) => {
    const previous = messages[index - 1];
    const day =
      message.createdAt && startsDay(message, previous)
        ? dayLabel(timestampDate(message.createdAt), now)
        : null;
    if (message.id === firstNew) {
      // On a day boundary the two share one line, in the "New" colour.
      rows.push({
        kind: "new",
        key: `new-${message.id}`,
        label: day ? `${day} · New` : "New",
      });
    } else if (day) {
      rows.push({ kind: "day", key: `day-${message.id}`, label: day });
    }
    rows.push({
      kind: "message",
      key: message.id,
      message,
      continued: continues(message, previous, firstNew, false),
    });
  });
  return rows;
}

// Where a thread's "New" line goes: above the oldest of its unread
// replies, which are the newest `unread` replies by others (the server's
// count, ThreadSummary.unread_count). Above the oldest held reply by
// others when fewer are held; none when nothing is unread.
export function firstUnreadReplyId(
  replies: Message[],
  unread: number,
  myUserId: string,
): string | undefined {
  if (unread <= 0) return undefined;
  const others = replies.filter(
    (reply) => !reply.deleted && reply.author?.id !== myUserId,
  );
  return others[Math.max(0, others.length - unread)]?.id;
}

// A thread's replies for a list, oldest first, by a thread's rules: no
// day lines (each reply's time carries its day), and the "New" line above
// firstNewId.
export function threadRows(
  replies: Message[],
  firstNewId: string | undefined,
): GroupedRow[] {
  const rows: GroupedRow[] = [];
  replies.forEach((reply, index) => {
    if (reply.id === firstNewId)
      rows.push({ kind: "new", key: `new-${reply.id}`, label: "New" });
    rows.push({
      kind: "message",
      key: reply.id,
      message: reply,
      continued: continues(reply, replies[index - 1], firstNewId, true),
    });
  });
  return rows;
}
