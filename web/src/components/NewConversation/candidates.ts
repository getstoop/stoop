import type { MessageAuthor } from "../../gen/stoop/chat/v1/message_pb";

// Who the picker offers: everyone reachable, minus the people already in
// the conversation, narrowed by what has been typed. Matching is on both
// the display name and the username, so searching for either finds them.
export function filterCandidates(
  users: MessageAuthor[],
  query: string,
  exclude: string[] = [],
): MessageAuthor[] {
  const skip = new Set(exclude);
  const q = query.trim().toLowerCase();
  return users.filter(
    (u) =>
      !skip.has(u.id) &&
      (q === "" ||
        u.username.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q)),
  );
}
