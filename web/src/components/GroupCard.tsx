import { Link } from "@tanstack/react-router";
import { groupCount } from "../api/groups";
import { canManageMembers } from "../api/permissions";
import { useMembers, useSpaces } from "../api/queries";
import type { Group } from "../gen/stoop/chat/v1/group_pb";
import { useAnchoredCard } from "../hooks/useAnchoredCard";
import { Avatar } from "./Avatar";
import { PeopleIcon } from "./Icons";

// A group's card, opened from its mention: its name, who is in it, and a
// way to its settings for those who manage members.
export function GroupCard({
  spaceId,
  group,
  anchor,
  onClose,
}: {
  spaceId: string;
  group: Group;
  anchor: DOMRect;
  onClose: () => void;
}) {
  const { ref, style } = useAnchoredCard(anchor, onClose);
  const { data: members } = useMembers(spaceId);
  const { data: spaces } = useSpaces();
  const space = spaces?.find((candidate) => candidate.id === spaceId);
  const people = group.userIds.flatMap((id) => {
    const member = members?.find((candidate) => candidate.userId === id);
    return member ? [member] : [];
  });

  return (
    <div
      ref={ref}
      className="user-card group-card popover"
      role="dialog"
      aria-label="Group"
      style={style}
    >
      <div className="user-card-header">
        <span className="group-mark large" aria-hidden="true">
          <PeopleIcon />
        </span>
        <div className="user-card-names">
          <strong>
            {group.name} <span className="muted">{groupCount(group)}</span>
          </strong>
          <span className="muted">@{group.handle}</span>
        </div>
      </div>
      {people.length === 0 ? (
        <p className="muted small">Nobody is in this group.</p>
      ) : (
        <ul className="group-card-people">
          {people.map((member) => (
            <li key={member.userId}>
              <Avatar
                name={member.displayName || member.username}
                fileId={member.avatarFileId}
                size="small"
              />
              <span className="member-name">
                {member.displayName || member.username}
              </span>
            </li>
          ))}
        </ul>
      )}
      {space && canManageMembers(space) && (
        <Link
          to="/s/$spaceId/settings"
          params={{ spaceId }}
          search={{ tab: "groups" }}
          className="muted small card-manage-link"
          onClick={onClose}
        >
          Edit in space settings
        </Link>
      )}
    </div>
  );
}
