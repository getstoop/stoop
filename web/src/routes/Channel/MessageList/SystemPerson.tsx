import { useAuthorShown } from "../../../api/authors";
import { BotMark } from "../../../components/BotMark";
import { DeletedMark } from "../../../components/DeletedMark";
import type { MentionMembers } from "../../../core/mentions";
import type { MessageAuthor } from "../../../gen/stoop/chat/v1/message_pb";

// Someone the row names, as the members list has them now (or their
// profile, once they are off it), opening their card as an author's name
// does.
export function SystemPerson({
  person,
  members,
  onCard,
}: {
  person: MessageAuthor;
  members: MentionMembers;
  onCard: (userId: string, anchor: DOMRect) => void;
}) {
  const shown = useAuthorShown(person, members) ?? person;
  return (
    <>
      <button
        type="button"
        className="system-person"
        onClick={(event) =>
          onCard(shown.id, event.currentTarget.getBoundingClientRect())
        }
      >
        {shown.displayName || shown.username}
      </button>
      <BotMark kind={shown.kind} />
      <DeletedMark deleted={shown.deleted} />
    </>
  );
}
