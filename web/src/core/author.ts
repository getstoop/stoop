import type { PublicProfile } from "../gen/stoop/auth/v1/auth_pb";
import type { Member } from "../gen/stoop/chat/v1/member_pb";
import type { MessageAuthor } from "../gen/stoop/chat/v1/message_pb";

// Who a message is shown as being from. A row embeds its author as they
// were when it was read; the members list (the sidebar's, kept current by
// member_updated) says who they are now, so a new name or avatar shows on
// old messages without the messages being fetched again. Someone not on
// the list (left, or deleted their account; a conversation's participants
// stand in for members in a DM) is shown from their profile when the
// caller has fetched one (api/authors.ts), which is where the deleted
// mark comes from; failing that, as embedded. The kind never changes and
// stays embedded. The same object comes back when nothing differs, so a
// row does not redraw for it.
export function authorShown(
  author: MessageAuthor | undefined,
  members: ReadonlyMap<string, Member>,
  profile?: PublicProfile | null,
): MessageAuthor | undefined {
  if (!author) return author;
  const member = members.get(author.id);
  const current = member ?? (profile?.id === author.id ? profile : undefined);
  if (!current) return author;
  const deleted = member ? author.deleted : (profile?.deleted ?? false);
  if (
    current.username === author.username &&
    current.displayName === author.displayName &&
    current.avatarFileId === author.avatarFileId &&
    deleted === author.deleted
  )
    return author;
  return {
    ...author,
    username: current.username,
    displayName: current.displayName,
    avatarFileId: current.avatarFileId,
    deleted,
  };
}
