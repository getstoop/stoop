import { timestampDate } from "@bufbuild/protobuf/wkt";
import { memo } from "react";
import { ReminderIcon, TrashIcon } from "../../../components/Icons";
import { dayAndTime, fullDateTime } from "../../../core/dates";
import type { MentionMembers } from "../../../core/mentions";
import type { Message } from "../../../gen/stoop/chat/v1/message_pb";
import { SystemPerson } from "./SystemPerson";

// A delivered reminder (docs/architecture/web.md → Reminders): a system
// row of its own look, so it is noticed. A bare bell in the avatar
// column, "Reminder from <name>" and the time on the head line, and the
// text under it at message size in full ink, as plain text exactly as
// typed: no Markdown, no mentions and no links. It never groups with the
// rows round it. Delete is the one action, for the person who set it and
// moderators (core/reminders mayDeleteReminder); nothing replies to,
// reacts to, edits, pins or quotes it.
export const ReminderRow = memo(function ReminderRow({
  message,
  index,
  top,
  measure,
  members,
  canDelete,
  withDay = false,
  rowIdPrefix = "msg-",
  onCard,
  onDelete,
}: {
  message: Message;
  // Its place in the virtualised list, as a MessageRow's.
  index: number;
  top: number;
  measure: (element: HTMLDivElement | null) => void;
  members: MentionMembers;
  canDelete: boolean;
  withDay?: boolean;
  rowIdPrefix?: string;
  onCard: (userId: string, anchor: DOMRect) => void;
  onDelete: (message: Message) => void;
}) {
  const created = message.createdAt
    ? timestampDate(message.createdAt)
    : undefined;
  const time = !created
    ? ""
    : withDay
      ? dayAndTime(created)
      : created.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div
      id={`${rowIdPrefix}${message.id}`}
      tabIndex={-1}
      className="system-row reminder-row"
      data-index={index}
      ref={measure}
      style={{ top }}
    >
      <span className="reminder-mark">
        <ReminderIcon />
      </span>
      <div className="reminder-head">
        <span className="reminder-from">
          <strong>Reminder</strong> from{" "}
          {message.author ? (
            <SystemPerson
              person={message.author}
              members={members}
              onCard={onCard}
            />
          ) : (
            "someone"
          )}
        </span>
        <span
          className="reminder-time"
          title={created && fullDateTime(created)}
        >
          {time}
        </span>
      </div>
      <div className="reminder-text">{message.content}</div>
      {canDelete && (
        <div className="message-toolbar">
          <button
            type="button"
            className="message-action danger"
            onClick={() => onDelete(message)}
            title="Delete"
            aria-label="Delete"
          >
            <TrashIcon />
          </button>
        </div>
      )}
    </div>
  );
});
