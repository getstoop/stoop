import { useState } from "react";
import { CheckIcon } from "../../../../components/Icons";
import type { MentionMembers } from "../../../../core/mentions";
import { type OptionResult, votesLabel } from "../../../../core/polls";
import { PollVoters } from "./PollVoters";

// One option of a poll: its share of the voters as a bar behind it, its
// text and count, and who chose it underneath. While the poll is open the
// top line is the vote's control: a radio with one choice, a checkbox
// with several, named with its count and whether it is the reader's
// vote. Closed, it is a line of the results, the reader's own vote ticked
// and the winner, or each tied option, badged.
export function PollOption({
  result,
  open,
  multiple,
  badge,
  pending,
  busy,
  myUserId,
  members,
  onVote,
}: {
  result: OptionResult;
  open: boolean;
  multiple: boolean;
  // The outcome badge a leading option wears once the poll is closed.
  badge: "winner" | "tied" | null;
  // This option was pressed and the server has yet to answer.
  pending: boolean;
  // Some option was: no other press is taken meanwhile.
  busy: boolean;
  myUserId: string | undefined;
  members: MentionMembers;
  onVote: (optionId: number) => void;
}) {
  const [othersFor, setOthersFor] = useState<DOMRect | null>(null);
  const className = [
    "poll-option",
    result.mine && "mine",
    badge && "won",
    pending && "pending",
  ]
    .filter(Boolean)
    .join(" ");
  const count = votesLabel(result.votes);
  const end = (
    <span className="poll-option-end">
      {badge && (
        <span className="badge poll-badge">
          {badge === "winner" ? "Winner" : "Tied"}
        </span>
      )}
      <span className="poll-option-count">{count}</span>
    </span>
  );
  const voters = result.votes > 0 && (
    <PollVoters
      result={result}
      myUserId={myUserId}
      members={members}
      shownFor={othersFor}
      onShow={setOthersFor}
    />
  );
  // The bar's width is the option's share, a value only the row knows.
  const bar = (
    <span
      className="poll-bar"
      style={{ "--poll-share": result.ratio } as React.CSSProperties}
    />
  );

  if (!open) {
    return (
      <li className={className}>
        {bar}
        <div className="poll-option-top">
          <span className="poll-mark">{result.mine && <CheckIcon />}</span>
          <span className="poll-option-text">
            {result.text}
            {result.mine && (
              <span className="visually-hidden">, your vote</span>
            )}
          </span>
          {end}
        </div>
        {voters}
      </li>
    );
  }

  // The same button either way; its role says which control it is. Not a
  // native input: each press sends a vote, and a radio group's arrow keys
  // would choose (and so send) one at every step. Each is a tab stop.
  const pick = {
    type: "button" as const,
    "aria-label": `${result.text}, ${count}${result.mine ? ", your vote" : ""}`,
    "aria-disabled": busy || undefined,
    className: "poll-option-top poll-pick",
    onClick: () => {
      if (!busy) onVote(result.id);
    },
  };
  const inside = (
    <>
      <span className={`poll-box${multiple ? "" : " radio"}`}>
        {result.mine && <CheckIcon />}
      </span>
      <span className="poll-option-text">{result.text}</span>
      {end}
    </>
  );
  return (
    <div className={className}>
      {bar}
      {multiple ? (
        // biome-ignore lint/a11y/useSemanticElements: a vote per press, above
        <button role="checkbox" aria-checked={result.mine} {...pick}>
          {inside}
        </button>
      ) : (
        // biome-ignore lint/a11y/useSemanticElements: a vote per press, above
        <button role="radio" aria-checked={result.mine} {...pick}>
          {inside}
        </button>
      )}
      {voters}
    </div>
  );
}
