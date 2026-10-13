import { isBot } from "../../api/identity";
import { roleLabel } from "../../api/permissions";
import { presenceClass, presenceLabel } from "../../api/presence";
import type { Member } from "../../gen/stoop/chat/v1/member_pb";
import { SpaceRole } from "../../gen/stoop/chat/v1/space_pb";
import { useConnectionStore } from "../../stores/connection";
import { Avatar } from "../Avatar";
import { BotMark } from "../BotMark";
import { CloseIcon } from "../Icons";
import { memberName } from "../MembersPanel/groups";

// One person in a private channel. onRemove is there for someone who may
// take them out, and never on the reader's own row: they leave instead.
export function PersonRow({
  member,
  self,
  onRemove,
}: {
  member: Member;
  self: boolean;
  onRemove?: () => void;
}) {
  const online = useConnectionStore((s) => s.online.has(member.userId));
  const dnd = useConnectionStore((s) => s.dnd[member.userId]);
  const bot = isBot(member.kind);
  const name = memberName(member);
  return (
    <li className="people-row">
      <Avatar
        name={name}
        fileId={member.avatarFileId}
        kind={member.kind}
        size="small"
      >
        {!bot && (
          <span
            className={`online-dot ${presenceClass(online, dnd)}`}
            role="img"
            aria-label={presenceLabel(online, dnd)}
          />
        )}
      </Avatar>
      <span className="member-name">{name}</span>
      {self && <span className="people-you">you</span>}
      <BotMark kind={member.kind} />
      {member.role !== SpaceRole.MEMBER && (
        <span className="badge">{roleLabel(member.role)}</span>
      )}
      {onRemove && !self && (
        <button
          type="button"
          className="icon-button people-remove"
          aria-label={`Remove ${name}`}
          title="Remove from channel"
          onClick={onRemove}
        >
          <CloseIcon />
        </button>
      )}
    </li>
  );
}
