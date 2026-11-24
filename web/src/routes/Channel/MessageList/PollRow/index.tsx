import { timestampDate } from "@bufbuild/protobuf/wkt";
import { memo, useId, useState } from "react";
import { useAuthorShown } from "../../../../api/authors";
import { errorText } from "../../../../api/errors";
import { setPollVote } from "../../../../api/polls";
import { Avatar } from "../../../../components/Avatar";
import { BotMark } from "../../../../components/BotMark";
import { DeletedMark } from "../../../../components/DeletedMark";
import { LockIcon, PinIcon, PollIcon } from "../../../../components/Icons";
import { authorShown } from "../../../../core/author";
import { dayAndTime, fullDateTime } from "../../../../core/dates";
import type { MentionMembers } from "../../../../core/mentions";
import {
  isPollOpen,
  mySelection,
  nextSelection,
  outcomeOf,
  pollOf,
  pollResults,
  votersLabel,
} from "../../../../core/polls";
import type { Message } from "../../../../gen/stoop/chat/v1/message_pb";
import { announce } from "../../../../stores/announcer";
import { notice } from "../../../../stores/dialogs";
import { ClosePoll } from "./ClosePoll";
import { PollActions } from "./PollActions";
import { PollOption } from "./PollOption";

// A poll in the timeline (docs/architecture/web.md → The message list):
// a card under its author's avatar and name, as a message is, that
// always heads its own group. Each option is a control while the poll is open, a radio
// with one choice and a checkbox with several; pressing one sends the
// reader's whole selection (core/polls nextSelection), and the card
// changes only when the server answers, the pressed option showing it is
// on its way meanwhile. Results show before voting. Who chose an option
// is named under it, with the rest behind "N others". Closed, the card
// shows the final results with the winner, or every tied option, marked.
// The toolbar has Copy link, Pin and Delete for those who may; Close is
// in the card's foot. Memoised as MessageRow is.
export const PollRow = memo(function PollRow({
  message,
  index,
  top,
  measure,
  link,
  myUserId,
  members,
  canClose,
  canDelete,
  canPin,
  rowIdPrefix = "msg-",
  onCard,
  onDelete,
  onTogglePin,
}: {
  message: Message;
  // Its place in the virtualised list, as a MessageRow's.
  index: number;
  top: number;
  measure: (element: HTMLDivElement | null) => void;
  link: string;
  myUserId: string | undefined;
  members: MentionMembers;
  // What the reader may do to it (core/polls pollPermissions).
  canClose: boolean;
  canDelete: boolean;
  canPin: boolean;
  rowIdPrefix?: string;
  onCard: (userId: string, anchor: DOMRect) => void;
  onDelete: (message: Message) => void;
  onTogglePin: (message: Message) => void;
}) {
  const questionId = useId();
  // The option pressed, until the server answers.
  const [pending, setPending] = useState<number | null>(null);
  const author = useAuthorShown(message.author, members);
  const poll = pollOf(message);
  if (!poll) return null;
  const open = isPollOpen(poll);
  const results = pollResults(poll, myUserId);
  const outcome = outcomeOf(poll, results);
  const mine = mySelection(poll, myUserId);
  const authorName = author?.displayName || author?.username || "?";
  const created = message.createdAt
    ? timestampDate(message.createdAt)
    : undefined;

  const vote = async (optionId: number) => {
    if (pending !== null) return;
    const next = nextSelection(poll, mine, optionId);
    const pressed = poll.options.find((option) => option.id === optionId);
    setPending(optionId);
    try {
      await setPollVote(message, next);
      announce(
        next.includes(optionId)
          ? `Voted for ${pressed?.text}`
          : `Vote for ${pressed?.text} taken back`,
      );
    } catch (err) {
      notice({ title: "Couldn't vote", body: errorText(err) });
    } finally {
      setPending(null);
    }
  };

  const multiple = poll.multiple;
  const options = results.map((result) => (
    <PollOption
      key={result.id}
      result={result}
      open={open}
      multiple={multiple}
      badge={result.leading ? outcome : null}
      pending={pending === result.id}
      busy={pending !== null}
      myUserId={myUserId}
      members={members}
      onVote={vote}
    />
  ));
  const closer = authorShown(poll.closedBy, members);
  const closedAt = poll.closedAt ? timestampDate(poll.closedAt) : undefined;

  return (
    <div
      id={`${rowIdPrefix}${message.id}`}
      tabIndex={-1}
      className="message poll-row"
      data-index={index}
      ref={measure}
      style={{ top }}
    >
      {message.pinned && (
        <div className="pinned-marker eyebrow">
          <PinIcon size={11} />
          Pinned
        </div>
      )}
      <button
        type="button"
        className="message-avatar"
        aria-label={`${authorName} — profile`}
        onClick={(event) =>
          author &&
          onCard(author.id, event.currentTarget.getBoundingClientRect())
        }
      >
        <Avatar
          name={authorName}
          fileId={author?.avatarFileId}
          kind={author?.kind}
          size="medium"
        />
      </button>
      <div className="message-meta">
        <button
          type="button"
          className="message-author"
          onClick={(event) =>
            author &&
            onCard(author.id, event.currentTarget.getBoundingClientRect())
          }
        >
          {authorName}
          <BotMark kind={author?.kind} />
          <DeletedMark deleted={author?.deleted} />
        </button>
        <span
          className="message-time"
          title={created ? fullDateTime(created) : undefined}
        >
          {created
            ? created.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })
            : ""}
        </span>
      </div>
      <div className="message-toolbar">
        <PollActions
          message={message}
          link={link}
          canPin={canPin}
          canDelete={canDelete}
          onTogglePin={() => onTogglePin(message)}
          onDelete={() => onDelete(message)}
        />
      </div>
      <section className="poll" aria-labelledby={questionId}>
        <div className="poll-head">
          <span className="poll-glyph">
            <PollIcon />
          </span>
          <h3 className="poll-question" id={questionId}>
            {poll.question}
          </h3>
          <span className="badge poll-state">{open ? "Poll" : "Closed"}</span>
        </div>
        {open ? (
          <p className="poll-kind">
            <span className={`poll-box${multiple ? "" : " radio"}`} />
            {multiple ? "Choose any number" : "Choose one"}
          </p>
        ) : (
          <p className="poll-kind">
            <LockIcon />
            Final results ·{" "}
            {multiple ? "any number of choices each" : "one choice each"}
          </p>
        )}
        {open ? (
          // One choice reads as a radio group, several as a group of
          // checkboxes; each option is a button that says which.
          <fieldset
            className="poll-options"
            role={multiple ? undefined : "radiogroup"}
            aria-labelledby={questionId}
            aria-busy={pending !== null}
          >
            {options}
          </fieldset>
        ) : (
          <ul className="poll-options" aria-label="Final results">
            {options}
          </ul>
        )}
        <div className="poll-foot">
          <span className="poll-foot-text">
            {open
              ? footOpen(poll.voterCount, mine.length > 0, multiple)
              : [
                  `Closed by ${closer?.displayName || closer?.username || "someone"}`,
                  closedAt ? dayAndTime(closedAt) : "",
                  votersLabel(poll.voterCount),
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </span>
          {open && canClose && <ClosePoll message={message} />}
        </div>
      </section>
    </div>
  );
});

// "5 people voted", and once the reader has: "· You can change your vote".
function footOpen(voters: number, voted: boolean, multiple: boolean): string {
  if (voters === 0) return "No votes yet";
  const count = votersLabel(voters);
  if (!voted) return count;
  return `${count} · You can change your vote${multiple ? "s" : ""}`;
}
