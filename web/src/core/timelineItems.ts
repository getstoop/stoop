import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Message } from "../gen/stoop/chat/v1/message_pb";
import { dayLabel } from "./dates";
import { continues, firstNewMessageId, startsDay } from "./grouping";

// The rows of a channel's timeline, oldest first: each message, a day line
// above the first of each day, and the "New" line above the first message
// after the read marker as it was on opening.

export type TimelineItem =
  | { kind: "message"; key: string; message: Message; continued: boolean }
  | { kind: "day" | "new"; key: string; label: string };

export function timelineItems(
  messages: Message[],
  newAfter: string | null,
  myUserId: string,
  now: Date = new Date(),
): TimelineItem[] {
  const firstNew = firstNewMessageId(messages, newAfter, myUserId);
  const items: TimelineItem[] = [];
  messages.forEach((message, index) => {
    const previous = messages[index - 1];
    const day =
      message.createdAt && startsDay(message, previous)
        ? dayLabel(timestampDate(message.createdAt), now)
        : null;
    if (message.id === firstNew) {
      // On a day boundary the two share one line, in the "New" colour.
      items.push({
        kind: "new",
        key: `new-${message.id}`,
        label: day ? `${day} · New` : "New",
      });
    } else if (day) {
      items.push({ kind: "day", key: `day-${message.id}`, label: day });
    }
    items.push({
      kind: "message",
      key: message.id,
      message,
      continued: continues(message, previous, firstNew, false),
    });
  });
  return items;
}
