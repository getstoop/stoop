import { create } from "@bufbuild/protobuf";
import type { QueryClient } from "@tanstack/react-query";
import type { Message } from "../gen/stoop/chat/v1/message_pb";
import {
  type Reaction,
  ReactionSchema,
} from "../gen/stoop/chat/v1/reaction_pb";
import { notice } from "../stores/dialogs";
import { chatClient } from "./clients";
import { errorText } from "./errors";

// Reactions live on Message.reactions in the messages cache. Both the RPC
// response and the ReactionsChanged event swap the whole list, so the
// server's grouping and order always win.

export function setReactions(
  queryClient: QueryClient,
  channelId: string,
  messageId: string,
  reactions: Reaction[],
) {
  queryClient.setQueryData<Message[]>(["messages", channelId], (old) =>
    old?.map((m) => (m.id === messageId ? { ...m, reactions } : m)),
  );
}

// What the list looks like after userId toggles emoji, for the optimistic
// update. New groups go last; the server's reply then settles the order.
export function toggledReactions(
  reactions: Reaction[],
  emoji: string,
  userId: string,
): Reaction[] {
  const group = reactions.find((r) => r.emoji === emoji);
  if (!group) {
    return [...reactions, create(ReactionSchema, { emoji, userIds: [userId] })];
  }
  const userIds = group.userIds.includes(userId)
    ? group.userIds.filter((id) => id !== userId)
    : [...group.userIds, userId];
  return reactions
    .map((r) => (r === group ? { ...r, userIds } : r))
    .filter((r) => r.userIds.length > 0);
}

export async function toggleReaction(
  queryClient: QueryClient,
  message: Message,
  emoji: string,
  userId: string,
) {
  const before = message.reactions;
  setReactions(
    queryClient,
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
      setReactions(
        queryClient,
        message.channelId,
        message.id,
        res.message.reactions,
      );
    }
  } catch (err) {
    setReactions(queryClient, message.channelId, message.id, before);
    notice({ title: "Couldn't react", body: errorText(err) });
  }
}
