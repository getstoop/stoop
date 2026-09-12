import { timestampDate } from "@bufbuild/protobuf/wkt";
import { fullDateTime, shortDateTime } from "../../api/dates";
import { useMe } from "../../api/queries";
import type { PinnedMessage } from "../../gen/stoop/chat/v1/pin_pb";
import { Attachments } from "../Attachments";
import { Avatar } from "../Avatar";
import { MessageBody } from "../MessageBody";

// One kept message: who said it and when, who pinned it, then the message
// itself clamped to a few lines. The row opens the channel at it.
export function PinRow({
  pin,
  usernames,
  canUnpin,
  onOpen,
  onUnpin,
}: {
  pin: PinnedMessage;
  // The space's handles, so @mentions in a kept message read as mentions.
  usernames: Set<string>;
  canUnpin: boolean;
  onOpen: () => void;
  onUnpin: () => void;
}) {
  const { data: me } = useMe();
  const message = pin.message;
  if (!message) return null;
  const who = message.author?.displayName || message.author?.username || "…";
  const when = message.createdAt ? timestampDate(message.createdAt) : null;
  const pinnedBy =
    pin.pinnedBy?.displayName || pin.pinnedBy?.username || "someone";
  const pinnedAt = pin.pinnedAt ? timestampDate(pin.pinnedAt) : null;
  return (
    <div className="pin-row">
      <button type="button" className="pin-row-open" onClick={onOpen}>
        <Avatar
          name={who}
          fileId={message.author?.avatarFileId ?? ""}
          size="small"
        />
        <span className="pin-row-title">
          <strong>{who}</strong>
          <span
            className="muted small"
            title={when ? fullDateTime(when) : undefined}
          >
            {when ? shortDateTime(when) : ""}
          </span>
        </span>
        <span className="pin-row-by muted">
          Pinned by {pinnedBy}
          {pinnedAt ? ` · ${shortDateTime(pinnedAt)}` : ""}
        </span>
        {/* Only the words are clamped; a strip of files keeps its own
            line under them. */}
        <span className="pin-row-body message-content">
          <MessageBody
            content={message.content}
            usernames={usernames}
            mentionsEveryone={message.mentionsEveryone}
            mentionsHere={message.mentionsHere}
            myUsername={me?.username}
          />
        </span>
        {message.attachments.length > 0 && (
          <span className="pin-row-files">
            <Attachments attachments={message.attachments} />
          </span>
        )}
      </button>
      {canUnpin && (
        <button
          type="button"
          className="icon-button pin-row-unpin"
          onClick={onUnpin}
          title="Unpin"
          aria-label={`Unpin ${who}'s message`}
        >
          ✕
        </button>
      )}
    </div>
  );
}
