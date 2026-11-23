import { timestampDate } from "@bufbuild/protobuf/wkt";
import { memo } from "react";
import { useAuthorShown } from "../../../api/authors";
import { BotMark } from "../../../components/BotMark";
import { DeletedMark } from "../../../components/DeletedMark";
import { TrashIcon } from "../../../components/Icons";
import { dayAndTime, fullDateTime } from "../../../core/dates";
import type { MentionMembers } from "../../../core/mentions";
import {
  type SystemGlyph,
  type SystemPart,
  systemLine,
} from "../../../core/systemMessages";
import type {
  Message,
  MessageAuthor,
} from "../../../gen/stoop/chat/v1/message_pb";

// A system message in the timeline (docs/architecture/web.md → System
// messages): a glyph in the avatar column, the sentence core/systemMessages
// words in muted text with names in full ink, and the time after it. No
// avatar, reactions or thread; a moderator's only action is Delete.
export const SystemRow = memo(function SystemRow({
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
  // The reader may delete any message here (a moderator); being the
  // row's author grants nothing.
  canDelete: boolean;
  withDay?: boolean;
  rowIdPrefix?: string;
  onCard: (userId: string, anchor: DOMRect) => void;
  onDelete: (message: Message) => void;
}) {
  const line = systemLine(message);
  if (!line) return null;
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
      className="system-row"
      data-index={index}
      ref={measure}
      style={{ top }}
    >
      <span className="system-glyph">
        <Glyph glyph={line.glyph} />
      </span>
      <span className="system-sentence">
        {line.parts.map((part, partIndex) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a row's parts never reorder
          <Part key={partIndex} part={part} members={members} onCard={onCard} />
        ))}
      </span>
      <span className="system-time" title={created && fullDateTime(created)}>
        {time}
      </span>
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

function Part({
  part,
  members,
  onCard,
}: {
  part: SystemPart;
  members: MentionMembers;
  onCard: (userId: string, anchor: DOMRect) => void;
}) {
  switch (part.kind) {
    case "text":
      return <>{part.text}</>;
    case "person":
      return <Person person={part.person} members={members} onCard={onCard} />;
    case "others":
      return <span className="system-emphasis">{part.label}</span>;
    case "channel":
      return part.current ? (
        <span className="system-emphasis">#{part.name}</span>
      ) : (
        <>#{part.name}</>
      );
    case "excerpt":
      return part.deleted ? (
        <span className="deleted-body">{part.text}</span>
      ) : (
        <>{part.text}</>
      );
  }
}

// Someone the row names, as the members list has them now (or their
// profile, once they are off it), opening their card as an author's name
// does.
function Person({
  person,
  members,
  onCard,
}: {
  person: MessageAuthor;
  members: MentionMembers;
  onCard: (userId: string, anchor: DOMRect) => void;
}) {
  const shown = useAuthorShown(person, members) ?? person;
  return (
    <>
      <button
        type="button"
        className="system-person"
        onClick={(event) =>
          onCard(shown.id, event.currentTarget.getBoundingClientRect())
        }
      >
        {shown.displayName || shown.username}
      </button>
      <BotMark kind={shown.kind} />
      <DeletedMark deleted={shown.deleted} />
    </>
  );
}

// The glyph for each kind, drawn at 16px in the avatar column.
const GLYPH_PATHS: Record<SystemGlyph, string> = {
  "person-plus":
    "M15 20v-1a5 5 0 0 0-5-5H8a5 5 0 0 0-5 5v1M9 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M19 8v6M16 11h6",
  "arrow-in": "M5 12h12M12 6l6 6-6 6",
  "arrow-out": "M19 12H7M12 6l-6 6 6 6",
  pencil: "M4 20h4L19 9l-4-4L4 16v4M13 7l4 4",
  "text-lines": "M4 7h16M4 12h16M4 17h10",
  pin: "M9 4h6l-1 6 3 3H7l3-3-1-6M12 13v7",
  megaphone: "M3 11v2l11 5V6L3 11M14 9h3a3 3 0 0 1 0 6h-3M6 14v4h3v-3",
  update: "M12 8v5M12 16h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18",
};

function Glyph({ glyph }: { glyph: SystemGlyph }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={GLYPH_PATHS[glyph]} />
    </svg>
  );
}
