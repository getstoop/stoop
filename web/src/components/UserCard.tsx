import { timestampDate } from "@bufbuild/protobuf/wkt";
import { ConnectError } from "@connectrpc/connect";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { setBlocked, useBlocked } from "../api/blocks";
import { openDirectMessage } from "../api/dms";
import { errorText } from "../api/errors";
import { canManageMembers, roleLabel } from "../api/permissions";
import { useMe, useMember, useSpaces, useUserProfile } from "../api/queries";
import { presenceClass, presenceLabel } from "../api/status";
import { useConnectionStore } from "../stores/connection";
import { confirm, dialogOpen, notice } from "../stores/dialogs";
import { Avatar } from "./Avatar";

// A small profile card, anchored below the element that opened it. Who
// they are comes from GetUserProfile, so it is the same in a space and in
// a direct message and always fresh — a renamed user shows their current
// name even on an old message. What they are *here* (role, badges, join
// date) comes from the membership, which a DM (spaceId "") has none of.
export function UserCard({
  spaceId,
  userId,
  anchor,
  onClose,
}: {
  spaceId: string;
  userId: string;
  anchor: DOMRect;
  onClose: () => void;
}) {
  const profileQuery = useUserProfile(userId);
  const profile = profileQuery.data;
  const memberQuery = useMember(spaceId, userId);
  const member = memberQuery.data;
  const { error, isLoading } = profileQuery;
  const navigate = useNavigate();
  const isOnline = useConnectionStore((s) => s.online.has(userId));
  const status = useConnectionStore((s) => s.presence[userId]);
  const { data: me } = useMe();
  const { data: spaces } = useSpaces();
  const queryClient = useQueryClient();
  const ref = useRef<HTMLDivElement>(null);
  const space = spaces?.find((s) => s.id === spaceId);
  const isSelf = me?.id === userId;
  const { data: blocked } = useBlocked();
  const isBlocked = !!blocked?.some((u) => u.id === userId);
  const name = profile?.displayName || profile?.username || "them";
  // Roles, kicks and bans are not on this card: they live in the space's
  // settings, where each one is spelled out. Managers get a link there.
  const canManage = !!space && !isSelf && canManageMembers(space);

  const message = async () => {
    try {
      const id = await openDirectMessage(queryClient, userId);
      onClose();
      navigate({ to: "/dm/$channelId", params: { channelId: id } });
    } catch (err) {
      notice({ title: "Couldn't start a conversation", body: errorText(err) });
    }
  };
  const toggleBlock = async () => {
    if (
      !isBlocked &&
      !(await confirm({
        title: `Block ${name}?`,
        body: "No direct messages either way, and no alerts from them. You can undo this from your profile.",
        action: "Block",
        danger: true,
      }))
    )
      return;
    try {
      await setBlocked(queryClient, userId, !isBlocked);
    } catch (err) {
      notice({ title: "Couldn't block", body: errorText(err) });
    }
  };

  useEffect(() => {
    // A dialog the card itself raised (Block) sits on top of it: its
    // buttons are outside the card, and dismissing the card under them
    // would take the answer's context away with it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !dialogOpen()) onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (dialogOpen()) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    // Deferred so the click that opened the card doesn't immediately close it.
    const id = setTimeout(() => window.addEventListener("mousedown", onClick));
    return () => {
      clearTimeout(id);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [onClose]);

  // Keep the card on screen: below the anchor, clamped to the viewport.
  const width = 280;
  const left = Math.max(
    8,
    Math.min(anchor.left, window.innerWidth - width - 8),
  );
  // Below the anchor, but never off the bottom: measured after each
  // render, since the card grows as the member and their actions load.
  const [top, setTop] = useState(anchor.bottom + 6);
  useLayoutEffect(() => {
    const h = ref.current?.getBoundingClientRect().height ?? 180;
    setTop(
      Math.max(8, Math.min(anchor.bottom + 6, window.innerHeight - h - 8)),
    );
  });

  return (
    <div
      ref={ref}
      className="user-card"
      role="dialog"
      aria-label="Member profile"
      style={{ left, top, width }}
    >
      {isLoading && <p className="muted">Loading…</p>}
      {error && (
        <p className="error">
          {error instanceof ConnectError ? error.rawMessage : String(error)}
        </p>
      )}
      {profile && (
        <>
          <div className="user-card-header">
            <Avatar
              name={profile.displayName || profile.username}
              fileId={profile.avatarFileId}
            />
            <div className="user-card-names">
              <strong>
                {profile.displayName || profile.username}
                {profile.pronouns && (
                  <span className="user-card-pronouns">
                    {" "}
                    · {profile.pronouns}
                  </span>
                )}
              </strong>
              <span className="muted">
                @{profile.username} ·{" "}
                <span
                  className={
                    isOnline ? `presence ${presenceClass(status)}` : "presence"
                  }
                >
                  {presenceLabel(isOnline, status)}
                </span>
              </span>
            </div>
          </div>
          {profile.bio && <p className="user-card-bio">{profile.bio}</p>}
          {member && (
            <div className="user-card-badges">
              <span className="badge">{roleLabel(member.role)}</span>
              {member.instanceAdmin && (
                <span className="badge" title="Operates this server">
                  server admin
                </span>
              )}
            </div>
          )}
          {member?.joinedAt && (
            <p className="muted small">
              Joined this space{" "}
              {timestampDate(member.joinedAt).toLocaleDateString()}
            </p>
          )}
          {!isSelf && (
            <div className="user-card-actions">
              {spaceId && (
                <button
                  type="button"
                  className="chip message-button"
                  onClick={message}
                >
                  Message
                </button>
              )}
              <button
                type="button"
                className="chip block-button"
                onClick={toggleBlock}
              >
                {isBlocked ? "Unblock" : "Block"}
              </button>
            </div>
          )}
          {canManage && (
            <Link
              to="/s/$spaceId/settings"
              params={{ spaceId }}
              search={{ tab: "members" }}
              className="muted small card-manage-link"
              onClick={onClose}
            >
              Manage members in space settings
            </Link>
          )}
        </>
      )}
    </div>
  );
}
