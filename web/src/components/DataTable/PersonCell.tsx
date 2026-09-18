import type { ReactNode } from "react";
import type { IdentityKind } from "../../gen/stoop/access/v1/access_pb";
import { Avatar } from "../Avatar";

// The identity cell of a people table: avatar, name with its badges, and
// the @username under it.
export function PersonCell({
  name,
  username,
  avatarFileId,
  kind,
  badges,
}: {
  name: string;
  username: string;
  avatarFileId?: string;
  kind?: IdentityKind;
  badges?: ReactNode;
}) {
  return (
    <div className="dt-person">
      <Avatar
        name={name || username}
        fileId={avatarFileId}
        kind={kind}
        size="small"
      />
      <div>
        <strong>
          {name || username}
          {badges}
        </strong>
        <span className="muted small">@{username}</span>
      </div>
    </div>
  );
}
