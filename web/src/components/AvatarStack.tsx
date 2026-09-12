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
  // What the one-person case labels its avatar with.
  name: string;
  size?: "" | "small" | "medium" | "large";
  children?: React.ReactNode;
}) {
  if (people.length < 2) {
    return (
      <Avatar name={name} fileId={people[0]?.avatarFileId} size={size}>
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
