import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import type { ReminderRequest } from "@stoop/core/reminderForm";
import { chatClient } from "./clients";

// A reminder's two writes (docs/architecture/messaging.md → Reminders), as
// web's api/reminders.ts makes them. Setting one posts nothing and
// touches no log: the row arrives as an ordinary message_created when the
// server delivers it. The request names a preset or the picked
// wall-clock time and the device's zone (core/reminderForm
// reminderRequest), never an instant: the server's clock decides.

export type SetReminder = { id: string; remindAt: Date };

// Sets it, answering with its id and the time as the server stored it,
// rounded down to the minute, which is the time to show. The server
// always answers one; shown (the device's reading of the form) only
// stands in should an answer ever come without it. It waits for the
// server however long it takes, as creating a poll does: there is no
// idempotency key, so one given up on while the server saved it would
// offer Set again and set a second.
export async function createReminder(
  origin: string,
  token: string,
  request: ReminderRequest,
  shown: Date,
): Promise<SetReminder> {
  const answer = await chatClient(origin, token).createReminder(request);
  return {
    id: answer.id,
    remindAt: answer.remindAt ? timestampDate(answer.remindAt) : shown,
  };
}

// Takes one back: "removed", "notFound" when the server no longer has it
// waiting (delivered meanwhile, or taken back by an earlier try whose
// answer was lost; the caller words which), or "failed" for anything
// that may pass on a second try.
export type UndoOutcome = "removed" | "notFound" | "failed";

export async function deleteReminder(origin: string, token: string, id: string): Promise<UndoOutcome> {
  try {
    await chatClient(origin, token).deleteReminder({ id });
    return "removed";
  } catch (err) {
    return err instanceof ConnectError && err.code === Code.NotFound ? "notFound" : "failed";
  }
}

// The server's own words, for a refusal that is a rule it holds (a line
// or a time it would not take, the cap, a channel the person can't post
// in), for core/reminderForm reminderRefusal; null for anything that may
// pass on a second try.
export function saidByServer(err: unknown): string | null {
  return err instanceof ConnectError && SAID_BY_SERVER.has(err.code) ? err.rawMessage : null;
}

const SAID_BY_SERVER = new Set([
  Code.InvalidArgument,
  Code.PermissionDenied,
  Code.FailedPrecondition,
  Code.NotFound,
  Code.ResourceExhausted,
]);
