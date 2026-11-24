import { Fragment, useCallback, useEffect, useRef } from "react";
import { Avatar } from "../../../../components/Avatar";
import { authorShown } from "../../../../core/author";
import type { MentionMembers } from "../../../../core/mentions";
import {
  type OptionResult,
  votersShown,
  votesLabel,
} from "../../../../core/polls";
import type { MessageAuthor } from "../../../../gen/stoop/chat/v1/message_pb";
import { useAnchoredCard } from "../../../../hooks/useAnchoredCard";

// Who chose an option, under it: their faces and "You, Jun and Sam", or
// past three "You, Jun and 12 others", where "12 others" opens the whole
// list for that option. Names are as the members list has them now; a
// voter who has left is named as the poll was sent.
export function PollVoters({
  result,
  myUserId,
  members,
  shownFor,
  onShow,
}: {
  result: OptionResult;
  myUserId: string | undefined;
  members: MentionMembers;
  // Where the whole list is anchored while it is open.
  shownFor: DOMRect | null;
  onShow: (anchor: DOMRect | null) => void;
}) {
  const opener = useRef<HTMLButtonElement>(null);
  const hide = useCallback(() => onShow(null), [onShow]);
  const shown = votersShown(result.voters, myUserId);
  const me = shown.you
    ? result.voters.find((voter) => voter.id === myUserId)
    : undefined;
  const named = shown.named.map((voter) => nowNamed(voter, members));
  const faces = [...(me ? [nowNamed(me, members)] : []), ...named];
  const words: { key: string; node: React.ReactNode }[] = [
    ...(me
      ? [{ key: "you", node: <strong className="poll-you">You</strong> }]
      : []),
    ...named.map((voter) => ({ key: voter.id, node: nameOf(voter) })),
  ];
  return (
    <div className="poll-voters">
      <span className="poll-faces" aria-hidden="true">
        {faces.slice(0, 3).map((voter) => (
          <Avatar
            key={voter.id}
            name={nameOf(voter)}
            fileId={voter.avatarFileId}
            kind={voter.kind}
            size="small"
          />
        ))}
      </span>
      <span className="poll-voters-names">
        {words.map((word, index) => (
          <Fragment key={word.key}>
            {index > 0 &&
              (index === words.length - 1 && shown.others === 0
                ? " and "
                : ", ")}
            {word.node}
          </Fragment>
        ))}
        {shown.others > 0 && (
          <>
            {" and "}
            <button
              ref={opener}
              type="button"
              className="poll-others"
              aria-haspopup="dialog"
              aria-expanded={!!shownFor}
              onClick={(event) =>
                onShow(
                  shownFor ? null : event.currentTarget.getBoundingClientRect(),
                )
              }
            >
              {shown.others} others
            </button>
          </>
        )}
      </span>
      {shownFor && (
        <VoterList
          result={result}
          myUserId={myUserId}
          members={members}
          anchor={shownFor}
          opener={opener}
          onClose={hide}
        />
      )}
    </div>
  );
}

// Everyone who chose the option, the reader first, then in the order
// they voted; scrolls past a screenful. It takes focus as it opens;
// Escape, or a click outside it, closes it, and Escape gives focus back to
// what opened it.
function VoterList({
  result,
  myUserId,
  members,
  anchor,
  opener,
  onClose,
}: {
  result: OptionResult;
  myUserId: string | undefined;
  members: MentionMembers;
  anchor: DOMRect;
  opener: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const { ref, style } = useAnchoredCard(anchor, onClose);
  useEffect(() => ref.current?.focus(), [ref]);
  const ordered = [
    ...result.voters.filter((voter) => voter.id === myUserId),
    ...result.voters.filter((voter) => voter.id !== myUserId),
  ].map((voter) => nowNamed(voter, members));
  return (
    <div
      ref={ref}
      className="popover poll-voter-list"
      style={style}
      role="dialog"
      aria-label={`Who chose ${result.text}`}
      tabIndex={-1}
      // Before the card's own Escape closes it, from the window.
      onKeyDown={(event) => {
        if (event.key === "Escape") opener.current?.focus();
      }}
    >
      <div className="poll-voter-list-head">
        <strong>{result.text}</strong>
        <span className="muted">{votesLabel(result.votes)}</span>
      </div>
      <ul>
        {ordered.map((voter) => (
          <li key={voter.id}>
            <Avatar
              name={nameOf(voter)}
              fileId={voter.avatarFileId}
              kind={voter.kind}
              size="small"
            />
            <span>
              {nameOf(voter)}
              {voter.deleted && <span className="muted"> (deleted)</span>}
              {voter.id === myUserId && <span className="muted"> (you)</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const nowNamed = (voter: MessageAuthor, members: MentionMembers) =>
  authorShown(voter, members) ?? voter;

const nameOf = (voter: MessageAuthor) =>
  voter.displayName || voter.username || "Someone";
