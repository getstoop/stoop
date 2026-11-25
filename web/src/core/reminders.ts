import type { Message } from "../gen/stoop/chat/v1/message_pb";

// A delivered reminder, as both apps read it (docs/architecture/
// messaging.md → Reminders): a system row of kind 9 whose text is its
// content, plain text exactly as typed (not Markdown, and a token-like
// run in it is nobody's mention), by the person who set it.

export const isReminderRow = (message: Message): boolean =>
  message.event?.kind.case === "reminder";

// Where a message is shown in brief (a search result, a linked message's
// card): "Reminder: " and the text as typed, as the server words its
// previews. Null for any other row.
export function reminderPreview(message: Message): string | null {
  return isReminderRow(message) ? `Reminder: ${message.content}` : null;
}

// Who may delete a delivered reminder: the person who set it, and in a
// space whoever holds messages.moderate; in a conversation the person who
// set it alone. Nothing else is offered on the row.
export function mayDeleteReminder({
  message,
  myUserId,
  inSpace,
  canModerate,
}: {
  message: Message;
  myUserId: string | undefined;
  // In a space's channel, not a direct message or group conversation.
  inSpace: boolean;
  // messages.moderate in the space.
  canModerate: boolean;
}): boolean {
  if (!isReminderRow(message) || message.deleted) return false;
  const mine = !!myUserId && message.author?.id === myUserId;
  return mine || (inSpace && canModerate);
}
