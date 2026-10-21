import { toggledReactions } from "../core/reactions";
import type { Message } from "../gen/stoop/chat/v1/message_pb";
import type { Reaction } from "../gen/stoop/chat/v1/reaction_pb";
import { notice } from "../stores/dialogs";
import { patchRow } from "./channelLog";
import { chatClient } from "./clients";
import { errorText } from "./errors";

// Reactions live on Message.reactions in the channel log. The reader's
// own toggle is written to the held row before the server answers, at the
// row's own seq, so the reactions_changed event that follows (at a higher
// seq) replaces it; each write swaps in a whole list, the server's
// grouping and order winning.

export function setReactions(
  channelId: string,
  messageId: string,
  reactions: Reaction[],
) {
  patchRow(channelId, messageId, (row) => ({ ...row, reactions }));
}

export async function toggleReaction(
  message: Message,
  emoji: string,
  userId: string,
) {
  const before = message.reactions;
  setReactions(
    message.channelId,
    message.id,
    toggledReactions(before, emoji, userId),
  );
  try {
    const res = await chatClient.toggleReaction({
      messageId: message.id,
      emoji,
    });
    if (res.message) {
      setReactions(message.channelId, message.id, res.message.reactions);
    }
  } catch (err) {
    setReactions(message.channelId, message.id, before);
    notice({ title: "Couldn't react", body: errorText(err) });
  }
}
