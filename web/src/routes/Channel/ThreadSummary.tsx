import { timestampDate } from "@bufbuild/protobuf/wkt";
import { fullDateTime, shortDateTime } from "../../api/dates";
import { Avatar } from "../../components/Avatar";
import { BellOffIcon } from "../../components/Icons";
import type { ThreadSummary as Summary } from "../../gen/stoop/chat/v1/message_pb";

// The line under a root that has replies: who replied lately, how many,
// when the last one came, and how many are new to you or that you muted
// it. Opens the thread.
export function ThreadSummary({
  thread,
  open,
  onOpen,
}: {
  thread: Summary;
  // The thread is already the one in the side panel.
  open: boolean;
  onOpen: () => void;
}) {
  const count = thread.replyCount;
  const unread = thread.unreadCount;
  const last = thread.lastReplyAt
    ? timestampDate(thread.lastReplyAt)
    : undefined;
  return (
    <button
      type="button"
      className={open ? "thread-summary open" : "thread-summary"}
      onClick={onOpen}
      aria-label={`${count} ${count === 1 ? "reply" : "replies"}${unread > 0 ? `, ${unread} new` : ""}${thread.muted ? ", muted" : ""}, open the thread`}
    >
      <span className="thread-faces" aria-hidden="true">
        {thread.recentAuthors.map((author) => (
          <Avatar
            key={author.id}
            name={author.displayName || author.username}
            fileId={author.avatarFileId}
            kind={author.kind}
            size="small"
          />
        ))}
      </span>
      <span className="thread-count">
        {count} {count === 1 ? "reply" : "replies"}
      </span>
      {unread > 0 && <span className="badge thread-new">{unread} new</span>}
      {thread.muted && (
        <span className="thread-muted-icon" title="Muted" aria-hidden="true">
          <BellOffIcon size={14} />
        </span>
      )}
      {last && (
        <span className="thread-last" title={fullDateTime(last)}>
          Last reply {shortDateTime(last)}
        </span>
      )}
    </button>
  );
}
