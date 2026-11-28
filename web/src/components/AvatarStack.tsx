import type { MessageAuthor } from "../gen/stoop/chat/v1/message_pb";
import { Avatar } from "./Avatar";

// The face of a group conversation: two avatars overlapped. One person
// renders as a plain avatar, so the DM list, the conversation header and
// the activity feed can all call this without asking how many there are.
export function AvatarStack({
  people,
  name,
  size = "small",
  children,
}: {
  people: MessageAuthor[];
  // What the avatar is labelled with when nobody is given. One person
  // is labelled with their own name: a title may say more than a name
  // ("Ada (you)"), and initials are drawn from the label.
  name: string;
  size?: "" | "small" | "medium" | "large";
  children?: React.ReactNode;
}) {
  if (people.length < 2) {
    return (
      <Avatar
        name={people[0]?.displayName || people[0]?.username || name}
        fileId={people[0]?.avatarFileId}
        size={size}
      >
        {children}
      </Avatar>
    );
  }
  return (
    <span className={`avatar-stack ${size}`.trim()}>
      {people.slice(0, 2).map((p) => (
        <Avatar
          key={p.id}
          name={p.displayName || p.username}
          fileId={p.avatarFileId}
          size={size}
        />
      ))}
    </span>
  );
}
