import { timestampDate } from "@bufbuild/protobuf/wkt";
import { fullDateTime, shortDateTime } from "../../api/dates";
import { Avatar } from "../../components/Avatar";
import type { ThreadSummary as Summary } from "../../gen/stoop/chat/v1/message_pb";

// The line under a root that has replies: who replied lately, how many,
// and when the last one came. Opens the thread.
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
  const last = thread.lastReplyAt
    ? timestampDate(thread.lastReplyAt)
    : undefined;
  return (
    <button
      type="button"
      className={open ? "thread-summary open" : "thread-summary"}
      onClick={onOpen}
      aria-label={`${count} ${count === 1 ? "reply" : "replies"}, open the thread`}
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
      {last && (
        <span className="thread-last" title={fullDateTime(last)}>
          Last reply {shortDateTime(last)}
        </span>
      )}
    </button>
  );
}
