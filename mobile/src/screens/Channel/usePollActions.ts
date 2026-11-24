import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import { useCallback, useEffect, useState } from "react";
import { errorText } from "../../api/errors";
import type { ChannelEngine } from "./channelEngine";
import { pressPollOption } from "./pendingVotes";

// What the channel screen does with its polls (docs/architecture/
// messaging.md → Polls): a press on an option (pendingVotes), Close poll and
// Delete poll from the poll's menu, and the votes sheet a card's View
// votes opens, held by the poll's id and read from the rows shown, so it
// follows the votes as they arrive and goes with the poll. What the
// server refuses is said in a line over the composer (`notify`), the
// card left as the server has it. A change of `scope` (another channel)
// lets the sheet go.
export function usePollActions({
  scope,
  shown,
  myUserId,
  engine,
  notify,
}: {
  scope: string;
  shown: Message[];
  myUserId: string | undefined;
  engine: Pick<ChannelEngine, "vote" | "closePoll" | "remove">;
  notify: (title: string, body?: string) => void;
}) {
  const { vote: send, closePoll, remove } = engine;
  const [votesFor, setVotesFor] = useState<string | null>(null);
  const [votesScope, setVotesScope] = useState(scope);
  if (votesScope !== scope) {
    setVotesScope(scope);
    setVotesFor(null);
  }

  const vote = useCallback(
    (message: Message, optionId: number) => {
      if (!myUserId) return;
      pressPollOption(send, message, optionId, myUserId).catch((err) => notify("Couldn't vote", errorText(err)));
    },
    [send, myUserId, notify],
  );
  const close = useCallback(
    (message: Message) => {
      closePoll(message).catch((err) => notify("Couldn't close the poll", errorText(err)));
    },
    [closePoll, notify],
  );
  // The poll goes with its votes, its pin and its closing row.
  const deletePoll = useCallback(
    (message: Message) => {
      remove(message).catch((err) => notify("Couldn't delete the poll", errorText(err)));
    },
    [remove, notify],
  );

  const viewVotes = useCallback((message: Message) => setVotesFor(message.id), []);
  const closeVotes = useCallback(() => setVotesFor(null), []);
  const votesMessage = votesFor ? shown.find((message) => message.id === votesFor) : undefined;
  const votesGone = !!votesFor && (!votesMessage || votesMessage.deleted);
  useEffect(() => {
    if (votesGone) setVotesFor(null);
  }, [votesGone]);

  return {
    vote,
    close,
    deletePoll,
    viewVotes,
    closeVotes,
    votesMessage: votesMessage && !votesMessage.deleted ? votesMessage : undefined,
  };
}
