import type { Message } from "../gen/stoop/chat/v1/message_pb";
import { holdRow } from "./channelLog";
import { chatClient } from "./clients";

// A poll's writes (docs/architecture/messaging.md → Polls). Nothing is
// applied before the server answers: the answer is the poll as it now
// stands, held as the reader's own send is (merged by seq, so whichever
// of it and the event is newer wins). A vote that changed nothing is
// answered with the poll as it was and no event follows, so the answer is
// what settles the card. A refusal throws for the caller to say.

// Sets the reader's whole selection; empty takes the vote back.
export async function setPollVote(
  poll: Message,
  optionIds: number[],
): Promise<void> {
  const { message } = await chatClient.setPollVote({
    messageId: poll.id,
    optionIds,
  });
  if (message) holdRow(poll.channelId, message);
}

// Closes it for good. Its closing row arrives as message_created.
export async function closePoll(poll: Message): Promise<void> {
  const { message } = await chatClient.closePoll({ messageId: poll.id });
  if (message) holdRow(poll.channelId, message);
}
