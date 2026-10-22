import { useQuery } from "@tanstack/react-query";
import { authorShown } from "../core/author";
import type { MentionMembers } from "../core/mentions";
import type { MessageAuthor } from "../gen/stoop/chat/v1/message_pb";
import { userProfileQuery } from "./queries";

// A row's author as they are now (core/author.ts): the member from the
// list, or for someone no longer on it their profile, fetched once per
// departed author and held for the session (member_updated and
// member_removed ask for it again), since it alone says the account was
// deleted. Departed authors are few; for everyone else the query is off.
export function useAuthorShown(
  author: MessageAuthor | undefined,
  members: MentionMembers,
): MessageAuthor | undefined {
  const userId = author?.id ?? "";
  const departed = userId !== "" && !members.has(userId);
  const { data: profile } = useQuery({
    ...userProfileQuery(userId),
    enabled: departed,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return authorShown(author, members, departed ? profile : undefined);
}
