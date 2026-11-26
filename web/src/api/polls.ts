import { useSyncExternalStore } from "react";
import type { PollRequest } from "../core/pollForm";
import { mySelection, nextSelection, optionLabel, pollOf } from "../core/polls";
import type { TimePollRequest } from "../core/timePollForm";
import type { Message } from "../gen/stoop/chat/v1/message_pb";
import { announce } from "../stores/announcer";
import { notice } from "../stores/dialogs";
import { holdRow, isLive, jumpToLatest } from "./channelLog";
import { chatClient } from "./clients";
import { errorText } from "./errors";

// A poll's writes (docs/architecture/messaging.md → Polls). Nothing is
// applied before the server answers: the answer is the poll as it now
// stands, held as the reader's own send is (merged by seq, so whichever
// of it and the event is newer wins). A vote that changed nothing is
// answered with the poll as it was and no event follows, so the answer is
// what settles the card.

// The vote on its way for each poll, by message id: the option pressed.
// Kept here rather than in the card, which the list unmounts when it
// scrolls away: a card drawn again while a vote is out still shows it,
// and still takes no other press.
const pending = new Map<string, number>();
const listeners = new Set<() => void>();

function setPending(messageId: string, optionId: number | null) {
  if (optionId === null) pending.delete(messageId);
  else pending.set(messageId, optionId);
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// A vote the server has not answered by then is given up, with the
// notice a refusal gets, so a stalled request never leaves the poll
// taking no press.
const VOTE_TIMEOUT_MS = 15_000;

// The option whose vote is on its way, or null.
export const pendingVote = (messageId: string): number | null =>
  pending.get(messageId) ?? null;

export function usePendingVote(messageId: string): number | null {
  return useSyncExternalStore(subscribe, () => pendingVote(messageId));
}

// The reader pressed an option: sends their whole selection with it
// pressed (core/polls nextSelection), unless a vote on this poll is
// already out, which the press waits for no more than a second press of
// a button does. A refusal is said in a notice and leaves the card as the
// server has it. Resolves once settled, with whether a vote was sent.
export async function pressPollOption(
  message: Message,
  optionId: number,
  myUserId: string | undefined,
): Promise<boolean> {
  const poll = pollOf(message);
  if (!poll || pending.has(message.id)) return false;
  const next = nextSelection(poll, mySelection(poll, myUserId), optionId);
  const pressed = poll.options.find((option) => option.id === optionId);
  const text = pressed ? optionLabel(pressed) : "";
  setPending(message.id, optionId);
  try {
    const answer = await chatClient.setPollVote(
      { messageId: message.id, optionIds: next },
      { timeoutMs: VOTE_TIMEOUT_MS },
    );
    if (answer.message) holdRow(message.channelId, answer.message);
    announce(
      next.includes(optionId)
        ? `Voted for ${text}`
        : `Vote for ${text} taken back`,
    );
  } catch (err) {
    notice({ title: "Couldn't vote", body: errorText(err) });
  } finally {
    setPending(message.id, null);
  }
  return true;
}

// Closes it for good. Its closing row arrives as message_created. A
// refusal throws for the caller to say.
export async function closePoll(poll: Message): Promise<void> {
  const { message } = await chatClient.closePoll({ messageId: poll.id });
  if (message) holdRow(poll.channelId, message);
}

// Posts a new poll (core/pollForm pollRequest), or a time poll
// (core/timePollForm timePollRequest). Resolves once the
// server has answered, and only a refusal of the poll itself rejects:
// the poll is saved by then, so what follows cannot fail the post. The
// answer is held as the reader's own send is; posted from inside
// history, the view moves to the newest page, and a failure to load it
// is a notice of its own.
export async function createPoll(
  request: PollRequest | TimePollRequest,
): Promise<void> {
  const { message } = await chatClient.createPoll(request);
  if (!message) return;
  const view = { channelId: request.channelId };
  if (isLive(view)) {
    holdRow(request.channelId, message);
    return;
  }
  jumpToLatest(view).catch((err) =>
    notice({ title: "Couldn't show the new poll", body: errorText(err) }),
  );
}
