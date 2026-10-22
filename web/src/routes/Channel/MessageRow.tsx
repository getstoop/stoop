import { timestampDate } from "@bufbuild/protobuf/wkt";
import { memo, type ReactNode, useMemo } from "react";
import { useAuthorShown } from "../../api/authors";
import { Attachments } from "../../components/Attachments";
import { Avatar } from "../../components/Avatar";
import { BotMark } from "../../components/BotMark";
import { DeletedMark } from "../../components/DeletedMark";
import { PinIcon } from "../../components/Icons";
import { LinkedMessages } from "../../components/LinkedMessages";
import { LinkPreviews } from "../../components/LinkPreviews";
import { MessageBody } from "../../components/MessageBody";
import { ReactionBar } from "../../components/ReactionBar";
import { authorShown } from "../../core/author";
import { dayAndTime, fullDateTime } from "../../core/dates";
import { emojiOnly } from "../../core/emojiText";
import type {
  MentionChannels,
  MentionGroups,
  MentionMembers,
} from "../../core/mentions";
import type { Group } from "../../gen/stoop/chat/v1/group_pb";
import type { Message } from "../../gen/stoop/chat/v1/message_pb";
import { MessageActions } from "./MessageActions";
import { MessageEditor } from "./MessageEditor";
import { ThreadSummary } from "./ThreadSummary";

// One message in a timeline: quote, author, toolbar, body, reactions, and
// on a root the line that opens its thread. A root deleted while its
// thread has replies is a placeholder that only opens the thread. The
// author, and the authors the quotes name, are shown as the members list
// has them now, or from their profile once they are off it
// (api/authors.ts). Memoised, so the list's own state (a picker, a card,
// scrolling) doesn't re-render rows; the handlers take the message so
// they can be shared.
export const MessageRow = memo(function MessageRow({
  message,
  continued,
  index,
  top,
  measure,
  spaceId,
  link,
  mine,
  canDelete,
  canPin,
  editing,
  members,
  groups,
  channels,
  myUserId,
  threadOpen,
  canStartThread,
  withDay = false,
  rowIdPrefix = "msg-",
  onJumpTo,
  onCard,
  onGroup,
  onReact,
  onReply,
  onEdit,
  onDelete,
  onDismissPreview,
  onTogglePin,
  onThread,
  onOpenOrigin,
  alsoSentTo,
}: {
  message: Message;
  // Same author within the minute: no avatar or author line.
  continued: boolean;
  // Its place in the virtualised list: the item index the virtualiser
  // measures it under, and its offset in the list's body. Absent on a row
  // drawn outside the list's body (a thread's root on the head).
  index?: number;
  top?: number;
  measure?: (element: HTMLDivElement | null) => void;
  spaceId: string;
  link: string;
  mine: boolean;
  canDelete: boolean;
  canPin: boolean;
  editing: boolean;
  members: MentionMembers;
  // The groups mentions name in this channel, by ID.
  groups: MentionGroups;
  // The channels a link may name in this channel, by ID.
  channels: MentionChannels;
  myUserId?: string;
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
  onGroup: (group: Group, anchor: DOMRect) => void;
  onReact: (message: Message, anchor: DOMRect) => void;
  onReply: (message: Message) => void;
  onEdit: (id: string | null) => void;
  onDelete: (message: Message) => void;
  // Shown where onDelete is: the author, or a moderator outside DMs.
  onDismissPreview: (message: Message, url: string) => void;
  onTogglePin: (message: Message) => void;
  // Opens its thread; absent inside a thread, where a reply has none.
  onThread?: (message: Message) => void;
  // In the channel, a reply also sent there opens its thread from the line
  // naming it.
  onOpenOrigin?: (message: Message) => void;
  // In its thread, where such a reply was also sent: "#general".
  alsoSentTo?: ReactNode;
}) {
  const editorMentions = useMemo(
    () => ({ members, groups, channels, channelAndHere: false }),
    [members, groups, channels],
  );
  const created = message.createdAt
    ? timestampDate(message.createdAt)
    : undefined;
  const time = !created
    ? ""
    : withDay
      ? dayAndTime(created)
      : created.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const fullTime = created ? fullDateTime(created) : undefined;
  const author = useAuthorShown(message.author, members);
  const quoted = useAuthorShown(message.replyTo?.author, members);
  const origin = authorShown(message.threadRoot?.author, members);
  const authorName = author?.displayName || author?.username || "?";
  const summary = message.thread && onThread && (
    <ThreadSummary
      thread={message.thread}
      open={threadOpen}
      onOpen={() => onThread(message)}
    />
  );
  const rowClass = [
    "message",
    continued && "continued",
    threadOpen && "thread-open",
  ]
    .filter(Boolean)
    .join(" ");

  // The virtualiser's attributes, only where it placed the row.
  const placement =
    top === undefined
      ? {}
      : { "data-index": index, ref: measure, style: { top } };

  if (message.deleted) {
    return (
      <div
        id={`${rowIdPrefix}${message.id}`}
        tabIndex={-1}
        className={`${rowClass} deleted-root`}
        {...placement}
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
      {...placement}
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
          <span>↩</span>
          <strong>
            {quoted?.displayName || quoted?.username || "deleted"}
            <BotMark kind={quoted?.kind} />
            <DeletedMark deleted={quoted?.deleted} />
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
          onClick={() => onOpenOrigin(message)}
          title="Open the thread"
        >
          <span>↳</span>
          <span>replied to a thread:</span>
          {origin && <strong>{origin.displayName || origin.username}</strong>}
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
            author && onCard(author.id, e.currentTarget.getBoundingClientRect())
          }
        >
          <Avatar
            name={authorName}
            fileId={author?.avatarFileId}
            kind={author?.kind}
            size="medium"
          />
        </button>
      )}
      <div className="message-meta">
        <button
          type="button"
          className="message-author"
          onClick={(e) =>
            author && onCard(author.id, e.currentTarget.getBoundingClientRect())
          }
        >
          {author?.displayName || author?.username}
          <BotMark kind={author?.kind} />
          <DeletedMark deleted={author?.deleted} />
        </button>
        <span className="message-time" title={fullTime}>
          {time}
        </span>
      </div>
      <div className="message-toolbar">
        <MessageActions
          message={message}
          link={link}
          mine={mine}
          canDelete={canDelete}
          canPin={canPin}
          onReply={() => onReply(message)}
          onEdit={() => onEdit(message.id)}
          onDelete={() => onDelete(message)}
          onReact={(anchor) => onReact(message, anchor)}
          onTogglePin={() => onTogglePin(message)}
          onThread={
            canStartThread && onThread ? () => onThread(message) : undefined
          }
        />
      </div>
      {editing ? (
        <MessageEditor
          message={message}
          mentions={editorMentions}
          onDone={() => onEdit(null)}
        />
      ) : null}
      <div
        className={`message-content ${emojiOnly(message.content) ? "emoji-only" : ""}`}
        hidden={editing}
      >
        <MessageBody
          content={message.content}
          members={members}
          mentionsEntireChannel={message.mentionsEntireChannel}
          mentionsHere={message.mentionsHere}
          myUserId={myUserId}
          onMention={onCard}
          groups={groups}
          onGroup={onGroup}
          channels={channels}
        />
        <Attachments attachments={message.attachments} />
        <LinkedMessages content={message.content} />
        <LinkPreviews
          previews={message.linkPreviews}
          onDismiss={
            canDelete ? (url) => onDismissPreview(message, url) : undefined
          }
        />
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
});
