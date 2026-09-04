import type { Message } from "../../gen/stoop/chat/v1/message_pb";

export function MessageActions({
  message,
  mine,
  canDelete,
  onReply,
  onEdit,
  onDelete,
  onReact,
}: {
  message: Message;
  mine: boolean;
  canDelete: boolean;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReact: (anchor: DOMRect) => void;
}) {
  return (
    <span className="message-actions" data-message={message.id}>
      <button
        type="button"
        className="message-action"
        onClick={(e) => onReact(e.currentTarget.getBoundingClientRect())}
        title="Add reaction"
        aria-label="Add reaction"
      >
        <ReactIcon />
      </button>
      <button
        type="button"
        className="message-action"
        onClick={onReply}
        title="Reply"
        aria-label="Reply"
      >
        <ReplyIcon />
      </button>
      {mine && (
        <button
          type="button"
          className="message-action"
          onClick={onEdit}
          title="Edit"
          aria-label="Edit"
        >
          <PencilIcon />
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          className="message-action danger"
          onClick={onDelete}
          title="Delete"
          aria-label="Delete"
        >
          <TrashIcon />
        </button>
      )}
    </span>
  );
}

const iconProps = {
  width: 15,
  height: 15,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

// A smiley with a small plus: "add reaction".
function ReactIcon() {
  return (
    <svg {...iconProps} aria-hidden="true">
      <circle cx="11" cy="13" r="8" />
      <path d="M8 15c.8 1.2 1.8 1.8 3 1.8s2.2-.6 3-1.8" />
      <path d="M8.5 11h.01M13.5 11h.01" />
      <path d="M19 2v6M16 5h6" />
    </svg>
  );
}

function ReplyIcon() {
  return (
    <svg {...iconProps} aria-hidden="true">
      <path d="M9 17l-5-5 5-5" />
      <path d="M4 12h9a6 6 0 0 1 6 6v1" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg {...iconProps} aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg {...iconProps} aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}
