import { create } from "@bufbuild/protobuf";
import {
  type Reaction,
  ReactionSchema,
} from "../gen/stoop/chat/v1/reaction_pb";

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
