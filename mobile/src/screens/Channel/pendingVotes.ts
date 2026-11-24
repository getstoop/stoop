import { mySelection, nextSelection, pollOf } from "@stoop/core/polls";
import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import { useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";

// A press on a poll's option (docs/architecture/messaging.md → Polls), as
// web's api/polls.ts makes one: the reader's whole selection with that
// option pressed (core/polls nextSelection) goes to the server, and the
// card changes only when the answer, or the event, lands; meanwhile the
// pressed option shows it is on its way and the card takes no other
// press. The vote on its way is kept here, by poll, rather than in the
// card, which the list unmounts when it scrolls away: a card drawn again
// while a vote is out still shows it.

const pending = new Map<string, number>();
const listeners = new Set<() => void>();

function setPending(messageId: string, optionId: number | null) {
  if (optionId === null) pending.delete(messageId);
  else pending.set(messageId, optionId);
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

// The option whose vote is on its way on this poll, or null.
export function usePendingVote(messageId: string): number | null {
  return useSyncExternalStore(subscribe, () => pending.get(messageId) ?? null);
}

// Sends the selection a press on optionId makes, through `vote` (the
// channel engine's, which merges the answer), unless a vote on this poll
// is out already. A screen reader hears what it did; a refusal is thrown
// for the caller to say, the card left as the server has it.
export async function pressPollOption(
  vote: (message: Message, optionIds: number[]) => Promise<void>,
  message: Message,
  optionId: number,
  myUserId: string,
): Promise<void> {
  const poll = pollOf(message);
  if (!poll || pending.has(message.id)) return;
  const next = nextSelection(poll, mySelection(poll, myUserId), optionId);
  const text = poll.options.find((option) => option.id === optionId)?.text ?? "";
  setPending(message.id, optionId);
  try {
    await vote(message, next);
    AccessibilityInfo.announceForAccessibility(
      next.includes(optionId) ? `Voted for ${text}` : `Vote for ${text} taken back`,
    );
  } finally {
    setPending(message.id, null);
  }
}
