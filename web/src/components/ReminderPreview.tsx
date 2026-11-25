import { reminderPreview } from "../core/reminders";
import type { Message } from "../gen/stoop/chat/v1/message_pb";
import { ReminderIcon } from "./Icons";
import { marked } from "./MessageBody";

// A delivered reminder where a message is shown in brief (a search
// result, a linked message's card): a bell and its one-line preview,
// "Reminder:" and the text as typed, never as Markdown and with no
// mentions or links. Nothing for another row. highlight marks a search's
// terms.
export function ReminderPreview({
  message,
  highlight,
}: {
  message: Message;
  highlight?: RegExp | null;
}) {
  const preview = reminderPreview(message);
  if (preview === null) return null;
  return (
    <span className="reminder-preview">
      <ReminderIcon />
      <span>{marked(preview, highlight)}</span>
    </span>
  );
}
