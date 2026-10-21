import type { Member } from "../gen/stoop/chat/v1/member_pb";
import type { MessageAuthor } from "../gen/stoop/chat/v1/message_pb";

// Who a message is shown as being from. A row embeds its author as they
// were when it was read; the members list (the sidebar's, kept current by
// member_updated) says who they are now, so a new name or avatar shows on
// old messages without the messages being fetched again. Someone not in
// the list (left, deleted; a conversation's participants stand in for
// members in a DM) stays as embedded, as does the kind, which never
// changes. The same object comes back when nothing differs, so a row
// does not redraw for it.
export function authorShown(
  author: MessageAuthor | undefined,
  members: ReadonlyMap<string, Member>,
): MessageAuthor | undefined {
  if (!author) return author;
  const member = members.get(author.id);
  if (
    !member ||
    (member.username === author.username &&
      member.displayName === author.displayName &&
      member.avatarFileId === author.avatarFileId)
  )
    return author;
  return {
    ...author,
    username: member.username,
    displayName: member.displayName,
    avatarFileId: member.avatarFileId,
  };
}
