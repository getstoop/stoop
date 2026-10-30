import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useInviteUses } from "../../../api/queries";
import { lastUsedText } from "../../../api/tokenOptions";
import { Avatar } from "../../../components/Avatar";
import type { Invite } from "../../../gen/stoop/chat/v1/invite_pb";

// Who joined through one invite, under its row: each person with when
// they came in, newest first.
export function InviteUses({ invite }: { invite: Invite }) {
  const { data: uses, isLoading } = useInviteUses(invite.id);
  return (
    <div className="invite-uses" data-uses-of={invite.code}>
      <span className="eyebrow">Joined with this invite</span>
      {isLoading && <p className="muted small">Loading…</p>}
      {uses && uses.length === 0 && <p className="muted small">Nobody yet.</p>}
      {uses && uses.length > 0 && (
        <ul>
          {uses.map((use) => (
            <li key={`${use.user?.id}:${use.usedAt?.seconds}`}>
              <Avatar
                name={use.user?.displayName || use.user?.username || "?"}
                fileId={use.user?.avatarFileId}
                kind={use.user?.kind}
                size="small"
              />
              <span>
                {use.user?.displayName || use.user?.username}
                <span className="muted small"> @{use.user?.username}</span>
              </span>
              <span className="muted small">
                {use.usedAt ? lastUsedText(timestampDate(use.usedAt)) : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
