import { useState } from "react";
import { deleteReminder, type SetReminder } from "../../../api/reminders";
import { CheckIcon, UndoIcon } from "../../../components/Icons";
import {
  TransientNotice,
  type TransientNoticeContent,
} from "../../../components/TransientNotice";
import {
  REMINDER_ALREADY_POSTED,
  REMINDER_NO_LONGER_WAITING,
  REMINDER_NOTICE_AFTER_MS,
  REMINDER_NOTICE_MS,
  REMINDER_REMOVED,
  REMINDER_UNDO_FAILED,
  reminderSetText,
} from "../../../core/reminderForm";

// A reminder just set, as its notice shows it: where names the channel or
// conversation it posts in when the notice is shown away from there.
export type ShownReminder = SetReminder & { where?: string };

// set: just set, Undo offered. undoing: the first Undo is out. failed:
// an Undo failed, Undo offered again. retrying: a later Undo is out.
// Then removed, posted (not found on the first try), or gone (not found
// after a failed try, which may have taken it back itself).
type Phase =
  | "set"
  | "undoing"
  | "failed"
  | "retrying"
  | "removed"
  | "posted"
  | "gone";

// The notice after a reminder is set (docs/architecture/web.md →
// Reminders): the time as the server stored it and Undo. Undo takes the
// reminder back and the notice then says so for a moment; if it was
// posted meanwhile, it says that; if Undo fails, it says so and Undo
// stays, and a retry keeps saying so while it is out. After the notice
// goes there is no way back to the reminder before it is posted.
export function ReminderNotice({
  set,
  onDone,
  returnFocus,
}: {
  set: ShownReminder | null;
  onDone: () => void;
  returnFocus: () => void;
}) {
  const [phase, setPhase] = useState<{ id: string; phase: Phase } | null>(null);
  // A phase belongs to the reminder it was reached for; a new one starts
  // at "set".
  const now = set && phase?.id === set.id ? phase.phase : "set";

  const undo = async () => {
    if (!set) return;
    const { id } = set;
    const retry = now === "failed";
    setPhase({ id, phase: retry ? "retrying" : "undoing" });
    const outcome = await deleteReminder(id);
    // Focus on Undo goes back to the words when the button goes
    // (TransientNotice). An answer for a reminder whose notice has since
    // given way to a newer one's state is dropped, so it cannot reset
    // that one's.
    const reached: Phase =
      outcome === "notFound" ? (retry ? "gone" : "posted") : outcome;
    setPhase((current) =>
      current?.id === id ? { id, phase: reached } : current,
    );
  };

  return (
    <TransientNotice
      notice={set && content(set, now, undo)}
      onDismiss={onDone}
      returnFocus={returnFocus}
    />
  );
}

function content(
  set: ShownReminder,
  phase: Phase,
  undo: () => void,
): TransientNoticeContent {
  const action = (busy: boolean) => ({
    label: "Undo",
    icon: <UndoIcon />,
    busy,
    onPress: undo,
  });
  switch (phase) {
    case "removed":
      return {
        key: `${set.id}-removed`,
        text: REMINDER_REMOVED,
        icon: <CheckIcon />,
        ms: REMINDER_NOTICE_AFTER_MS,
      };
    case "posted":
    case "gone":
      return {
        key: `${set.id}-${phase}`,
        text:
          phase === "posted"
            ? REMINDER_ALREADY_POSTED
            : REMINDER_NO_LONGER_WAITING,
        ms: REMINDER_NOTICE_MS,
      };
    case "failed":
    case "retrying":
      // One key for both, so a retry neither says it again nor restarts
      // the time.
      return {
        key: `${set.id}-failed`,
        text: REMINDER_UNDO_FAILED,
        action: action(phase === "retrying"),
        ms: REMINDER_NOTICE_MS,
        hold: phase === "retrying",
      };
    case "set":
    case "undoing":
      return {
        key: `${set.id}-set`,
        text: reminderSetText(set.remindAt, new Date(), set.where),
        icon: <CheckIcon />,
        action: action(phase === "undoing"),
        ms: REMINDER_NOTICE_MS,
        hold: phase === "undoing",
      };
  }
}
