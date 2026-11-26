import { type Timestamp, timestampDate } from "@bufbuild/protobuf/wkt";
import type {
  Message,
  MessageAuthor,
  Poll,
} from "../gen/stoop/chat/v1/message_pb";
import { slotLabel } from "./dates";

// A poll as both apps read it (docs/architecture/messaging.md → Polls):
// the row carries the question, the options and who chose each, and
// everything else, the reader's own vote among it, is worked out here.
// The drawing is each app's own.

// The poll a row is, or undefined for any other row. A poll is a system
// message on the wire (isSystemRow is true for it) but is drawn as a card
// under its author, not as a system line, so the lists ask this first.
export function pollOf(message: Message): Poll | undefined {
  const kind = message.event?.kind;
  return kind?.case === "poll" ? kind.value : undefined;
}

export const isPollRow = (message: Message): boolean => !!pollOf(message);

export const isPollOpen = (poll: Poll): boolean => !poll.closedAt;

// A time poll: its options carry an instant (`at`) and no text. A poll is
// all text or all times.
export const isTimePoll = (poll: Poll): boolean =>
  poll.options.some((option) => !!option.at);

// The instant an option or a winner carries, or null on a text one.
export const instantOf = (item: { at?: Timestamp }): Date | null =>
  item.at ? timestampDate(item.at) : null;

// What an option is called wherever it is shown: its text, or on a time
// poll its time in the reader's zone (slotLabel).
export function optionLabel(
  option: { text: string; at?: Timestamp },
  now: Date = new Date(),
): string {
  const at = instantOf(option);
  return at ? slotLabel(at, now) : option.text;
}

// The one-line preview of a poll or its closing row, as the server words
// it for the activity feed and a pin's excerpt (previewOf in
// internal/chat/polls.go): the question as typed, not Markdown. Null for
// any other row.
export function pollPreview(message: Message): string | null {
  switch (message.event?.kind.case) {
    case "poll":
      return `Poll: ${message.content || message.event.kind.value.question}`;
    case "pollClosed":
      return `Poll closed: ${message.content || message.event.kind.value.question}`;
    default:
      return null;
  }
}

// The options the reader has chosen, by id, in the poll's order.
export function mySelection(
  poll: Poll,
  myUserId: string | undefined,
): number[] {
  if (!myUserId) return [];
  return poll.options
    .filter((option) => option.voters.some((voter) => voter.id === myUserId))
    .map((option) => option.id);
}

// The selection to send when the reader presses an option: the whole of
// it, as SetPollVote takes it. With one choice, pressing another option
// moves the vote and pressing the reader's own takes it back (empty);
// with several, pressing one adds or removes just that one.
export function nextSelection(
  poll: Poll,
  mine: readonly number[],
  optionId: number,
): number[] {
  const chosen = mine.includes(optionId);
  if (!poll.multiple) return chosen ? [] : [optionId];
  const next = chosen
    ? mine.filter((id) => id !== optionId)
    : [...mine, optionId];
  // In the poll's order, so the same choice is always the same list.
  const order = poll.options.map((option) => option.id);
  return next.sort((left, right) => order.indexOf(left) - order.indexOf(right));
}

export type OptionResult = {
  id: number;
  text: string;
  // A time poll's instant, null on a text poll.
  at: Date | null;
  // What the option is called: its text, or its time (optionLabel).
  label: string;
  // A time that has gone by, by the clock the results were worked out
  // at. It still takes votes; the card marks it.
  passed: boolean;
  votes: number;
  // The bar: this option's votes over the people who voted, 0 to 1. With
  // several choices the bars add up to more than one, as each person may
  // be in several.
  ratio: number;
  mine: boolean;
  // Among the most votes, when that is at least one (the winner rule).
  leading: boolean;
  voters: MessageAuthor[];
};

// Each option as it stands, in the poll's order (a time poll's is
// earliest first). now is the clock a time is labelled and judged passed
// by: worked out as the card draws, with no timer.
export function pollResults(
  poll: Poll,
  myUserId: string | undefined,
  now: Date = new Date(),
): OptionResult[] {
  const top = Math.max(
    0,
    ...poll.options.map((option) => option.voters.length),
  );
  return poll.options.map((option) => {
    const votes = option.voters.length;
    const at = instantOf(option);
    return {
      id: option.id,
      text: option.text,
      at,
      label: at ? slotLabel(at, now) : option.text,
      passed: !!at && at.getTime() <= now.getTime(),
      votes,
      ratio: poll.voterCount > 0 ? Math.min(1, votes / poll.voterCount) : 0,
      mine: !!myUserId && option.voters.some((voter) => voter.id === myUserId),
      leading: top > 0 && votes === top,
      voters: option.voters,
    };
  });
}

// What a closed poll says about each leading option: "winner" when one
// option has the most votes, "tied" for each when several share it.
// Nothing while the poll is open, or when nobody voted.
export function outcomeOf(
  poll: Poll,
  results: readonly OptionResult[],
): "winner" | "tied" | null {
  if (isPollOpen(poll)) return null;
  const leading = results.filter((result) => result.leading).length;
  if (leading === 0) return null;
  return leading === 1 ? "winner" : "tied";
}

// "1 vote", "3 votes".
export const votesLabel = (count: number): string =>
  count === 1 ? "1 vote" : `${count} votes`;

// "1 person voted", "6 people voted", "Nobody voted".
export const votersLabel = (count: number): string =>
  count === 0
    ? "Nobody voted"
    : count === 1
      ? "1 person voted"
      : `${count} people voted`;

// Above this many voters, an option names the first two and counts the
// rest, as a system line names people.
const NAMED = 3;

// Who chose an option, as the card lists them: the reader first as "You",
// then the rest in the order they voted. Up to three are named; past
// that the first two are, and the rest are counted ("You, Jun and 12
// others"). `named` are the people to name, `others` how many are left.
export function votersShown(
  voters: readonly MessageAuthor[],
  myUserId: string | undefined,
): { you: boolean; named: MessageAuthor[]; others: number } {
  const you = !!myUserId && voters.some((voter) => voter.id === myUserId);
  const rest = you ? voters.filter((voter) => voter.id !== myUserId) : voters;
  const total = rest.length + (you ? 1 : 0);
  const room = total > NAMED ? 2 - (you ? 1 : 0) : rest.length;
  return { you, named: rest.slice(0, room), others: rest.length - room };
}

// Who may do what to a poll, as the server allows it; these only hide
// controls. Close: its author, or in a space whoever moderates messages,
// and only while it is open. Delete: the same, whether open or closed.
// Pin: whoever pins in that place today (never in a conversation, where
// nobody pins).
export function pollPermissions({
  message,
  myUserId,
  inSpace,
  canModerate,
  canPin,
}: {
  message: Message;
  myUserId: string | undefined;
  // In a space's channel, not a direct message or group conversation.
  inSpace: boolean;
  // messages.moderate in the space.
  canModerate: boolean;
  // Whoever pins messages here.
  canPin: boolean;
}): { close: boolean; delete: boolean; pin: boolean } {
  const poll = pollOf(message);
  if (!poll || message.deleted)
    return { close: false, delete: false, pin: false };
  const mine = !!myUserId && message.author?.id === myUserId;
  const may = mine || (inSpace && canModerate);
  return {
    close: may && isPollOpen(poll),
    delete: may,
    pin: inSpace && canPin,
  };
}
