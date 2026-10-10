import { timestampDate } from "@bufbuild/protobuf/wkt";
import { dayAndTime, fullDateTime } from "../../api/dates";
import { Attachments } from "../../components/Attachments";
import { Avatar } from "../../components/Avatar";
import { BotMark } from "../../components/BotMark";
import { DeletedMark } from "../../components/DeletedMark";
import { PinIcon } from "../../components/Icons";
import { LinkPreviews } from "../../components/LinkPreviews";
import { MessageBody } from "../../components/MessageBody";
import { ReactionBar } from "../../components/ReactionBar";
import type { Message } from "../../gen/stoop/chat/v1/message_pb";
import { MessageActions } from "./MessageActions";
import { MessageEditor } from "./MessageEditor";
import { ThreadSummary } from "./ThreadSummary";

// One message in a timeline: quote, author, toolbar, body, reactions, and
// on a root the line that opens its thread. A root deleted while its
// thread has replies is a placeholder that only opens the thread.
export function MessageRow({
  message,
  continued,
  spaceId,
  link,
  mine,
  canDelete,
  canPin,
  editing,
  usernames,
  myUsername,
  threadOpen,
  canStartThread,
  withDay = false,
  rowIdPrefix = "msg-",
  onJumpTo,
  onCard,
  onReact,
  onReply,
  onEdit,
  onDelete,
  onTogglePin,
  onThread,
  onOpenOrigin,
  alsoSentTo,
}: {
  message: Message;
  // Same author within the minute: no avatar or author line.
  continued: boolean;
  spaceId: string;
  link: string;
  mine: boolean;
  canDelete: boolean;
  canPin: boolean;
  editing: boolean;
  usernames: Set<string>;
  myUsername?: string;
  // Its thread is the one open in the side panel.
  threadOpen: boolean;
  // The toolbar offers to start a thread (not in an announcement channel).
  canStartThread: boolean;
  // The time says its day too, where no day separator does (a thread).
  withDay?: boolean;
  // Element ids are this plus the message id: "msg-" in a channel, and
  // something else in a thread, whose root is on the page twice.
  rowIdPrefix?: string;
  onJumpTo: (id: string) => void;
  onCard: (userId: string, anchor: DOMRect) => void;
  onReact: (anchor: DOMRect) => void;
  onReply: () => void;
  onEdit: (id: string | null) => void;
  onDelete: () => void;
  onTogglePin: () => void;
  // Opens its thread; absent inside a thread, where a reply has none.
  onThread?: () => void;
  // In the channel, a reply also sent there opens its thread from the line
  // naming it.
  onOpenOrigin?: () => void;
  // In its thread, where such a reply was also sent: "#general".
  alsoSentTo?: string;
}) {
  const created = message.createdAt
    ? timestampDate(message.createdAt)
    : undefined;
  const time = !created
    ? ""
    : withDay
      ? dayAndTime(created)
      : created.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const fullTime = created ? fullDateTime(created) : undefined;
  const authorName =
    message.author?.displayName || message.author?.username || "?";
  const summary = message.thread && onThread && (
    <ThreadSummary
      thread={message.thread}
      open={threadOpen}
      onOpen={onThread}
    />
  );
  const rowClass = [
    "message",
    continued && "continued",
    threadOpen && "thread-open",
  ]
    .filter(Boolean)
    .join(" ");

  if (message.deleted) {
    return (
      <div
        id={`${rowIdPrefix}${message.id}`}
        tabIndex={-1}
        className={`${rowClass} deleted-root`}
      >
        <span className="message-avatar" aria-hidden="true">
          <span className="avatar medium placeholder-avatar" />
        </span>
        <div className="message-content">
          <span className="deleted-body">Original message deleted</span>
        </div>
        {summary}
      </div>
    );
  }

  return (
    <div
      id={`${rowIdPrefix}${message.id}`}
      // Focusable by tap/click (not Tab) so the toolbar shows on touch
      // screens, where there is no hover.
      tabIndex={-1}
      className={rowClass}
    >
      {message.pinned && (
        <div className="pinned-marker eyebrow">
          <PinIcon size={11} />
          Pinned
        </div>
      )}
      {message.replyTo && (
        <button
          type="button"
          className="reply-quote"
          onClick={() => onJumpTo(message.replyTo?.messageId ?? "")}
          title="Jump to the original message"
        >
          <span className="reply-arrow">↩</span>
          <strong>
            {message.replyTo.author?.displayName ||
              message.replyTo.author?.username ||
              "deleted"}
            <BotMark kind={message.replyTo.author?.kind} />
            <DeletedMark deleted={message.replyTo.author?.deleted} />
          </strong>
          <span className="reply-preview">
            {message.replyTo.preview || "(message deleted)"}
          </span>
        </button>
      )}
      {message.threadRoot && onOpenOrigin && (
        <button
          type="button"
          className="reply-quote thread-origin"
          onClick={onOpenOrigin}
          title="Open the thread"
        >
          <span className="reply-arrow">↳</span>
          <span>replied to a thread:</span>
          {message.threadRoot.author && (
            <strong>
              {message.threadRoot.author.displayName ||
                message.threadRoot.author.username}
            </strong>
          )}
          <span className="reply-preview">
            {message.threadRoot.preview || "(message deleted)"}
          </span>
        </button>
      )}
      {!continued && (
        <button
          type="button"
          className="message-avatar"
          aria-label={`${authorName} — profile`}
          onClick={(e) =>
            message.author &&
            onCard(message.author.id, e.currentTarget.getBoundingClientRect())
          }
        >
          <Avatar
            name={authorName}
            fileId={message.author?.avatarFileId}
            kind={message.author?.kind}
            size="medium"
          />
        </button>
      )}
      <div className="message-meta">
        <button
          type="button"
          className="message-author"
          onClick={(e) =>
            message.author &&
            onCard(message.author.id, e.currentTarget.getBoundingClientRect())
          }
        >
          {message.author?.displayName || message.author?.username}
          <BotMark kind={message.author?.kind} />
          <DeletedMark deleted={message.author?.deleted} />
        </button>
        <span className="message-time" title={fullTime}>
          {time}
        </span>
      </div>
      <div className="message-toolbar">
        {continued && (
          <span className="message-time" title={fullTime}>
            {time}
          </span>
        )}
        <MessageActions
          message={message}
          link={link}
          mine={mine}
          canDelete={canDelete}
          canPin={canPin}
          onReply={onReply}
          onEdit={() => onEdit(message.id)}
          onDelete={onDelete}
          onReact={onReact}
          onTogglePin={onTogglePin}
          onThread={canStartThread ? onThread : undefined}
        />
      </div>
      {editing ? (
        <MessageEditor message={message} onDone={() => onEdit(null)} />
      ) : null}
      <div className="message-content" hidden={editing}>
        <MessageBody
          content={message.content}
          usernames={usernames}
          mentionsEveryone={message.mentionsEveryone}
          mentionsHere={message.mentionsHere}
          mentionsChannel={message.mentionsChannel}
          myUsername={myUsername}
        />
        <Attachments attachments={message.attachments} />
        <LinkPreviews previews={message.linkPreviews} />
        {message.editedAt && (
          <span className="edited-marker" title="Edited">
            (edited)
          </span>
        )}
        {alsoSentTo && (
          <span className="edited-marker also-sent-marker">
            Also sent to {alsoSentTo}
          </span>
        )}
      </div>
      <ReactionBar message={message} spaceId={spaceId} />
      {summary}
    </div>
  );
}
