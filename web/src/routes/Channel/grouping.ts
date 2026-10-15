import { timestampDate } from "@bufbuild/protobuf/wkt";
import { sameDay } from "../../api/dates";
import type { Message } from "../../gen/stoop/chat/v1/message_pb";

// A day separator goes above the first message of each calendar day.
export const startsDay = (m: Message, prev: Message | undefined) =>
  !prev?.createdAt ||
  !m.createdAt ||
  !sameDay(timestampDate(prev.createdAt), timestampDate(m.createdAt));

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
