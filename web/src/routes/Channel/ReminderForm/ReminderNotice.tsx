import { useState } from "react";
import { deleteReminder, type SetReminder } from "../../../api/reminders";
import { CheckIcon, UndoIcon } from "../../../components/Icons";
import {
  TransientNotice,
  type TransientNoticeContent,
} from "../../../components/TransientNotice";
import {
  REMINDER_ALREADY_POSTED,
  REMINDER_NOTICE_AFTER_MS,
  REMINDER_NOTICE_MS,
  REMINDER_REMOVED,
  REMINDER_UNDO_FAILED,
  reminderSetText,
} from "../../../core/reminderForm";

type Phase = "set" | "undoing" | "removed" | "posted" | "failed";

// The notice after a reminder is set (docs/architecture/web.md →
// Reminders): the time as the server stored it and Undo. Undo takes the
// reminder back and the notice then says so for a moment; if it was
// posted meanwhile, it says that; if Undo fails, it says so and Undo
// stays. After the notice goes there is no way back to the reminder
// before it is posted. Nothing is shown while no reminder was just set,
// but the live region stays, so the next one is announced.
export function ReminderNotice({
  set,
  onDone,
  returnFocus,
}: {
  set: SetReminder | null;
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
    setPhase({ id, phase: "undoing" });
    // Focus on Undo goes back to the words when the button goes
    // (TransientNotice).
    setPhase({ id, phase: await deleteReminder(id) });
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
  set: SetReminder,
  phase: Phase,
  undo: () => void,
): TransientNoticeContent {
  const key = `${set.id}-${phase === "undoing" ? "set" : phase}`;
  switch (phase) {
    case "removed":
      return {
        key,
        text: REMINDER_REMOVED,
        icon: <CheckIcon />,
        ms: REMINDER_NOTICE_AFTER_MS,
      };
    case "posted":
      return { key, text: REMINDER_ALREADY_POSTED, ms: REMINDER_NOTICE_MS };
    default:
      return {
        key,
        text:
          phase === "failed"
            ? REMINDER_UNDO_FAILED
            : reminderSetText(set.remindAt, new Date()),
        icon: phase === "failed" ? undefined : <CheckIcon />,
        action: {
          label: "Undo",
          icon: <UndoIcon />,
          busy: phase === "undoing",
          onPress: undo,
        },
        ms: REMINDER_NOTICE_MS,
        hold: phase === "undoing",
      };
  }
}
