import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { chatClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { canManageMembers } from "../../api/permissions";
import { Avatar } from "../../components/Avatar";
import { ListHead } from "../../components/ListHead";
import type { Space } from "../../gen/stoop/chat/v1/space_pb";

// Who's banned from the space, with the reason if one was given. Only
// people who manage members see it; unbanning lets them join again by
// any invite.
export function BansSection({ space }: { space: Space }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { data: bans } = useQuery({
    queryKey: ["bans", space.id],
    queryFn: async () =>
      (await chatClient.listBans({ spaceId: space.id })).bans,
    enabled: canManageMembers(space),
  });
  const unban = async (userId: string) => {
    setError(null);
    try {
      await chatClient.unbanMember({ spaceId: space.id, userId });
      await queryClient.invalidateQueries({ queryKey: ["bans", space.id] });
    } catch (err) {
      setError(errorText(err));
    }
  };
  if (!canManageMembers(space)) return null;
  return (
    <section className="card bans-section">
      <h3>Banned</h3>
      <p className="hint">
        Banned people are refused by every invite link. Unbanning lets them back
        in with any link, but doesn't re-add them.
      </p>
      {bans && bans.length === 0 && (
        <p className="muted small">Nobody is banned from this space.</p>
      )}
      <ul className="user-list table">
        {bans && bans.length > 0 && (
          <ListHead columns={["Person", "Reason", ""]} />
        )}
        {bans?.map((b) => (
          <li key={b.user?.id} className="user-row">
            <div className="user-row-main">
              <strong className="user-row-name">
                <Avatar
                  name={b.user?.displayName || b.user?.username || "?"}
                  fileId={b.user?.avatarFileId}
                  size="small"
                />
                {b.user?.displayName || b.user?.username}
              </strong>
              <span className="muted small">@{b.user?.username}</span>
            </div>
            <span className="user-cell">{b.reason}</span>
            <div className="user-row-actions">
              <button
                type="button"
                className="chip"
                onClick={() => b.user && unban(b.user.id)}
              >
                Unban
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
