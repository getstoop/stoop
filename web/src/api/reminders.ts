import { timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import type { ReminderRequest } from "../core/reminderForm";
import { chatClient } from "./clients";

// A reminder's two writes (docs/architecture/messaging.md → Reminders).
// Setting one posts nothing and touches no log: the row arrives as an
// ordinary message_created when the server delivers it.

export type SetReminder = { id: string; remindAt: Date };

// Sets it, answering with its id and the time as the server stored it,
// rounded down to the minute, which is the time to show.
export async function createReminder(
  request: ReminderRequest,
): Promise<SetReminder> {
  const answer = await chatClient.createReminder({
    channelId: request.channelId,
    text: request.text,
    remindAt: timestampFromDate(request.remindAt),
  });
  return {
    id: answer.id,
    remindAt: answer.remindAt
      ? timestampDate(answer.remindAt)
      : request.remindAt,
  };
}

// Takes one back: "removed", "notFound" when the server no longer has it
// waiting (delivered meanwhile, or taken back by an earlier try whose
// answer was lost; the caller words which), or "failed" for anything
// that may pass on a second try.
export type UndoOutcome = "removed" | "notFound" | "failed";

export async function deleteReminder(id: string): Promise<UndoOutcome> {
  try {
    await chatClient.deleteReminder({ id });
    return "removed";
  } catch (err) {
    return err instanceof ConnectError && err.code === Code.NotFound
      ? "notFound"
      : "failed";
  }
}
