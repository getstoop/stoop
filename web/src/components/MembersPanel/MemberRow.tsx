import { roleLabel } from "../../api/permissions";
import { presenceClass } from "../../api/status";
import type { Member } from "../../gen/stoop/chat/v1/member_pb";
import { SpaceRole } from "../../gen/stoop/chat/v1/space_pb";
import type { PresenceStatus } from "../../gen/stoop/realtime/v1/realtime_pb";
import { Avatar } from "../Avatar";
import { memberName } from "./groups";

export function MemberRow({
  member,
  online,
  presence,
  onOpen,
}: {
  member: Member;
  online: boolean;
  presence?: PresenceStatus;
  onOpen: (anchor: DOMRect) => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={`member-row ${online ? "online" : "offline"}`}
        onClick={(e) => onOpen(e.currentTarget.getBoundingClientRect())}
      >
        <Avatar
          name={memberName(member)}
          fileId={member.avatarFileId}
          size="small"
        >
          {online && (
            <span className={`online-dot ${presenceClass(presence)}`} />
          )}
        </Avatar>
        <span className="member-name">{memberName(member)}</span>
        {member.role !== SpaceRole.MEMBER && (
          <span className="badge">{roleLabel(member.role)}</span>
        )}
      </button>
    </li>
  );
}
