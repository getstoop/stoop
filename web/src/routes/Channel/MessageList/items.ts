import { timestampDate } from "@bufbuild/protobuf/wkt";
import { dayLabel } from "../../../core/dates";
import { continues, startsDay } from "../../../core/grouping";
import type { Message } from "../../../gen/stoop/chat/v1/message_pb";

// The rows of a timeline, oldest first, each one an item the virtualiser
// positions and measures on its own: the head (the window's older edge —
// "Loading…", the beginning marker, or a thread's root), a day line above
// the first message of each day, the "New messages" line above the first
// unread one, every message, and the foot (the newer edge). A divider is a
// row beside the messages, never a wrapper round one: from a divider, the
// message it introduces is the next sibling. The phone's channel draws
// from core/timelineItems; this is the web's form, with a thread's rules
// (no day lines, the root above the oldest reply).

export type ListItem =
  | { kind: "head"; key: "head"; rootId?: string }
  | { kind: "foot"; key: "foot" }
  | { kind: "day"; key: string; label: string }
  | { kind: "new"; key: string; label: string; startsDay: boolean }
  | { kind: "message"; key: string; message: Message; continued: boolean };

export function listItems({
  messages,
  firstNewId,
  inThread,
  rootShownId,
  now = new Date(),
}: {
  messages: Message[];
  // The message under the "New messages" line, if any.
  firstNewId: string | undefined;
  inThread: boolean;
  // A thread's root, when the head shows it (nothing older than the
  // window): a jump to it lands on the head.
  rootShownId?: string;
  now?: Date;
}): ListItem[] {
  const items: ListItem[] = [
    { kind: "head", key: "head", rootId: rootShownId },
  ];
  messages.forEach((message, index) => {
    const previous = messages[index - 1];
    const day =
      !inThread && message.createdAt && startsDay(message, previous)
        ? dayLabel(timestampDate(message.createdAt), now)
        : null;
    if (message.id === firstNewId) {
      // When the unread line falls on a day boundary the two share one
      // divider, in the unread line's colour.
      items.push({
        kind: "new",
        key: `new-${message.id}`,
        label: day ? `${day} · New messages` : "New messages",
        startsDay: !!day,
      });
    } else if (day) {
      items.push({ kind: "day", key: `day-${message.id}`, label: day });
    }
    items.push({
      kind: "message",
      key: message.id,
      message,
      continued: continues(message, previous, firstNewId, inThread),
    });
  });
  items.push({ kind: "foot", key: "foot" });
  return items;
}

// The index of the item a jump to messageId lands on: its row, or the head
// when it is the root shown there. -1 when the window doesn't hold it.
export function indexOfMessage(items: ListItem[], messageId: string): number {
  return items.findIndex(
    (item) =>
      (item.kind === "message" && item.message.id === messageId) ||
      (item.kind === "head" && item.rootId === messageId),
  );
}

// The index of the "New messages" line, or -1.
export function indexOfNewLine(items: ListItem[]): number {
  return items.findIndex((item) => item.kind === "new");
}

// A row's height before it is measured: close enough that the scrollbar
// and the first landing are about right, corrected as rows render.
export function estimateSize(item: ListItem): number {
  switch (item.kind) {
    case "head":
    case "foot":
      return 50;
    case "day":
      return 40;
    case "new":
      return 30;
    case "message":
      return item.continued ? 24 : 46;
  }
}
