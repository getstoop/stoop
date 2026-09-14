import type { ReactNode } from "react";
import { Avatar } from "../Avatar";

// A bot as a row: who it is, where it stands, and the credentials it
// holds indented beneath.
export function BotRow({
  username,
  displayName,
  avatarFileId,
  standing,
  inactive,
  actions,
  children,
}: {
  username: string;
  displayName: string;
  avatarFileId?: string;
  // "admin, so it can notify everyone", "member", "deactivated"…
  standing: string;
  inactive?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <>
      <li
        className={`user-row ${inactive ? "inactive" : ""}`}
        data-bot={username}
      >
        <div className="user-row-main">
          <strong>
            <Avatar
              name={displayName || username}
              fileId={avatarFileId}
              size="small"
            />{" "}
            {displayName || username}
          </strong>
          <span className="muted small">@{username} · bot</span>
        </div>
        <span className="user-cell">{standing}</span>
        <span className="user-cell" />
        {actions ? <div className="user-row-actions">{actions}</div> : <span />}
      </li>
      {children && <li className="bot-credentials">{children}</li>}
    </>
  );
}
