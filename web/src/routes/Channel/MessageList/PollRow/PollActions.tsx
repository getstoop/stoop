import { useEffect, useState } from "react";
import { copyShareLink } from "../../../../api/shareLinks";
import {
  CheckIcon,
  LinkIcon,
  PinIcon,
  TrashIcon,
} from "../../../../components/Icons";
import type { Message } from "../../../../gen/stoop/chat/v1/message_pb";

// A poll's toolbar: Copy link for everyone, Pin for whoever pins here,
// Delete for its author and moderators. Nothing else a message offers: a
// poll takes no reaction, reply, thread, quote or edit.
export function PollActions({
  message,
  link,
  canPin,
  canDelete,
  onTogglePin,
  onDelete,
}: {
  message: Message;
  link: string;
  canPin: boolean;
  canDelete: boolean;
  onTogglePin: () => void;
  onDelete: () => void;
}) {
  // The tick that stands in for the icon once the link is copied.
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  return (
    <span className="message-actions" data-message={message.id}>
      <button
        type="button"
        className="message-action"
        onClick={async () => {
          if (await copyShareLink(link)) setCopied(true);
        }}
        title={copied ? "Copied!" : "Copy link"}
        aria-label={copied ? "Link copied" : "Copy link"}
      >
        {copied ? <CheckIcon /> : <LinkIcon />}
      </button>
      {canPin && (
        <button
          type="button"
          className={`message-action ${message.pinned ? "on" : ""}`}
          onClick={onTogglePin}
          title={message.pinned ? "Unpin" : "Pin"}
          aria-label={message.pinned ? "Unpin" : "Pin"}
        >
          <PinIcon size={15} filled={message.pinned} />
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          className="message-action danger"
          onClick={onDelete}
          title="Delete poll"
          aria-label="Delete poll"
        >
          <TrashIcon />
        </button>
      )}
    </span>
  );
}
