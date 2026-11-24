import { SEND_STALL_MS } from "@stoop/core/drafts";
import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import { chatClient } from "./clients";

// A poll's writes (docs/architecture/messaging.md → Polls). Each answers
// with the poll as it stands after the write, for the screen to merge as
// it merges a send's answer (core/channelScreen `sent`). A vote and a
// close wait as long as a send does (api/messages); creating one waits
// for the server however long it takes, as web's does: there is no
// idempotency key, so a create given up on while the server saved it
// would offer Post again and make a second poll.

const TIMEOUT_MS = SEND_STALL_MS;

// A new poll in the channel, with no deadline (above). The server checks
// what the form checks, and whether the reader may post here.
export async function createPoll(
  origin: string,
  token: string,
  channelId: string,
  question: string,
  options: string[],
  multiple: boolean,
): Promise<Message> {
  const { message } = await chatClient(origin, token).createPoll({ channelId, question, options, multiple });
  if (!message) throw new Error("The server answered with nothing.");
  return message;
}

// The reader's whole selection on a poll, by option id; an empty one takes
// the vote back. A selection the server holds already is answered with
// the poll and no event follows, so the answer is what settles the card.
export async function setPollVote(
  origin: string,
  token: string,
  messageId: string,
  optionIds: number[],
): Promise<Message | undefined> {
  const { message } = await chatClient(origin, token).setPollVote(
    { messageId, optionIds },
    { timeoutMs: TIMEOUT_MS },
  );
  return message;
}

// Closes the poll for good; its closing row arrives as a message of its own.
export async function closePoll(origin: string, token: string, messageId: string): Promise<Message | undefined> {
  const { message } = await chatClient(origin, token).closePoll({ messageId }, { timeoutMs: TIMEOUT_MS });
  return message;
}
