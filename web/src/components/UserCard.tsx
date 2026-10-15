import { timestampDate } from "@bufbuild/protobuf/wkt";
import { ConnectError } from "@connectrpc/connect";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { setBlocked, useBlocked } from "../api/blocks";
import { openDirectMessage } from "../api/dms";
import { errorText } from "../api/errors";
import { isBot } from "../api/identity";
import { mentionToken } from "../api/mentions";
import { canManageMembers, roleLabel } from "../api/permissions";
import { presenceClass, presenceLabel } from "../api/presence";
import { useMe, useMember, useSpaces, useUserProfile } from "../api/queries";
import { InstanceRole } from "../gen/stoop/auth/v1/auth_pb";
import { useAnchoredCard } from "../hooks/useAnchoredCard";
import { useConnectionStore } from "../stores/connection";
import { confirm, notice } from "../stores/dialogs";
import { Avatar } from "./Avatar";
import { BotMark } from "./BotMark";
import { CopyButton } from "./CopyButton";
import { DeletedMark } from "./DeletedMark";

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
  const dnd = useConnectionStore((s) => s.dnd[userId]);
  const { data: me } = useMe();
  const { data: spaces } = useSpaces();
  const queryClient = useQueryClient();
  const { ref, style } = useAnchoredCard(anchor, onClose);
  const space = spaces?.find((s) => s.id === spaceId);
  const isSelf = me?.id === userId;
  const { data: blocked } = useBlocked();
  const isBlocked = !!blocked?.some((u) => u.id === userId);
  const name = profile?.displayName || profile?.username || "them";
  // A bot can't be messaged, and has no presence; its face and bio are
  // an instance admin's to set, under Integrations.
  const bot = isBot(profile?.kind);
  const instanceAdmin = me?.role === InstanceRole.ADMIN;
  // Roles, kicks and bans are not on this card: they live in the space's
  // settings, where each one is spelled out. Managers get a link there.
  const canManage = !!space && !isSelf && canManageMembers(space);

  const message = async () => {
    try {
      const id = await openDirectMessage(queryClient, [userId]);
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

  return (
    <div
      ref={ref}
      className="user-card popover"
      role="dialog"
      aria-label="Member profile"
      style={style}
    >
      {isLoading && <p className="muted">Loading…</p>}
      {error && (
        <p className="error" role="alert">
          {error instanceof ConnectError ? error.rawMessage : String(error)}
        </p>
      )}
      {profile && (
        <>
          <div className="user-card-header">
            <Avatar
              name={profile.displayName || profile.username}
              fileId={profile.avatarFileId}
              kind={profile.kind}
            />
            <div className="user-card-names">
              <strong>
                {profile.displayName || profile.username}
                <BotMark kind={profile.kind} />
                <DeletedMark deleted={profile.deleted} />
                {profile.pronouns && (
                  <span className="user-card-pronouns">
                    {" "}
                    · {profile.pronouns}
                  </span>
                )}
              </strong>
              <span className="muted">
                @{profile.username} ·{" "}
                {bot ? (
                  "bot"
                ) : (
                  <span className={`presence ${presenceClass(isOnline, dnd)}`}>
                    {presenceLabel(isOnline, dnd)}
                  </span>
                )}
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
          <div className="user-card-actions">
            {!isSelf && spaceId && !bot && (
              <button
                type="button"
                className="chip message-button"
                onClick={message}
              >
                Message
              </button>
            )}
            {!isSelf && (
              <button
                type="button"
                className="chip block-button"
                onClick={toggleBlock}
              >
                {isBlocked ? "Unblock" : "Block"}
              </button>
            )}
            {profile && (
              <CopyButton
                label="Copy mention"
                text={mentionToken({
                  kind: "person",
                  id: userId,
                  handle: profile.username.toLowerCase(),
                })}
              />
            )}
          </div>
          {bot && instanceAdmin && (
            <Link
              to="/admin"
              search={{ tab: "integrations" }}
              className="muted small card-manage-link"
              onClick={onClose}
            >
              Manage this bot in Server admin
            </Link>
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
