import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { chatClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { canActOn, canManageMembers, roleLabel } from "../../api/permissions";
import { useMe, useMembers } from "../../api/queries";
import { Avatar } from "../../components/Avatar";
import { ListHead } from "../../components/ListHead";
import { InstanceRole } from "../../gen/stoop/auth/v1/auth_pb";
import type { Member } from "../../gen/stoop/chat/v1/member_pb";
import { type Space, SpaceRole } from "../../gen/stoop/chat/v1/space_pb";
import { confirm } from "../../stores/dialogs";

export function MembersSection({ space }: { space: Space }) {
  const queryClient = useQueryClient();
  const { data: members } = useMembers(space.id);
  const { data: me } = useMe();
  const [error, setError] = useState<string | null>(null);
  const viewerIsInstanceAdmin = me?.role === InstanceRole.ADMIN;
  // Same filter + scroll cap as the server admin's Accounts card.
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? members?.filter(
        (m) =>
          m.username.toLowerCase().includes(needle) ||
          m.displayName.toLowerCase().includes(needle),
      )
    : members;

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: ["members", space.id] });
    } catch (err) {
      setError(errorText(err));
    }
  };
  const setRole = (m: Member, role: SpaceRole) =>
    act(() =>
      chatClient.setMemberRole({ spaceId: space.id, userId: m.userId, role }),
    );
  const kick = async (m: Member) => {
    const ok = await confirm({
      title: `Remove ${m.displayName || m.username} from ${space.name}?`,
      action: "Remove",
      danger: true,
    });
    if (!ok) return;
    act(() => chatClient.kickMember({ spaceId: space.id, userId: m.userId }));
  };
  const ban = async (m: Member) => {
    const ok = await confirm({
      title: `Ban ${m.displayName || m.username} from ${space.name}?`,
      body: "They'll be removed and can't come back until unbanned.",
      action: "Ban",
      danger: true,
    });
    if (!ok) return;
    act(async () => {
      await chatClient.banMember({ spaceId: space.id, userId: m.userId });
      await queryClient.invalidateQueries({ queryKey: ["bans", space.id] });
    });
  };

  if (!canManageMembers(space)) {
    return (
      <section className="card">
        <h3>Members</h3>
        <p className="hint">Only the owner and admins can manage members.</p>
      </section>
    );
  }
  return (
    <section className="card">
      <h3>Members</h3>
      <p className="hint">
        Admins can change roles and remove people; only the owner can act on an
        admin.
      </p>
      <p className="hint">
        - <strong>Kick</strong> removes someone now — they can come back with
        any invite link.
      </p>
      <p className="hint">
        - <strong>Ban</strong> removes them and keeps them out until you unban
        them below.
      </p>

      {members && members.length > 0 && (
        <div className="user-filter">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name or @username"
            aria-label="Filter members"
          />
          <span className="muted small">
            {shown?.length === members.length
              ? `${members.length} member${members.length === 1 ? "" : "s"}`
              : `${shown?.length ?? 0} of ${members.length}`}
          </span>
        </div>
      )}
      {shown && shown.length === 0 && needle && (
        <p className="muted small">No members match “{query.trim()}”.</p>
      )}
      <ul className="user-list table">
        <ListHead columns={["Person", "Role", ""]} />
        {shown?.map((m) => {
          const self = m.userId === me?.id;
          const actionable =
            !self && canActOn(space, viewerIsInstanceAdmin, m.role);
          return (
            <li key={m.userId} className="user-row">
              <div className="user-row-main">
                <strong className="user-row-name">
                  <Avatar
                    name={m.displayName || m.username}
                    fileId={m.avatarFileId}
                    size="small"
                  />
                  {m.displayName || m.username}
                </strong>
                <span className="muted small">@{m.username}</span>
              </div>
              <span className="user-cell">
                {capitalize(roleLabel(m.role))}
                {m.instanceAdmin && <span className="badge">server admin</span>}
              </span>
              {actionable ? (
                <div className="user-row-actions">
                  {m.role === SpaceRole.MEMBER ? (
                    <button
                      type="button"
                      className="chip"
                      onClick={() => setRole(m, SpaceRole.ADMIN)}
                    >
                      Make admin
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="chip"
                      onClick={() => setRole(m, SpaceRole.MEMBER)}
                    >
                      Remove admin
                    </button>
                  )}
                  <button
                    type="button"
                    className="chip danger"
                    title="Remove now; they can come back with any invite link"
                    onClick={() => kick(m)}
                  >
                    Kick
                  </button>
                  <button
                    type="button"
                    className="chip danger ban-button"
                    title="Remove and refuse every invite link until unbanned"
                    onClick={() => ban(m)}
                  >
                    Ban
                  </button>
                </div>
              ) : (
                <span className="muted small">{self ? "you" : ""}</span>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
