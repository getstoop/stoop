import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { setBlocked, useBlocked } from "../../api/blocks";
import { errorText } from "../../api/errors";
import { Avatar } from "../../components/Avatar";
import { ListHead } from "../../components/ListHead";

// People you've blocked. Hidden until there's someone in it; the card
// that blocked them may be hard to find again, so undo lives here.
export function BlockedSection() {
  const queryClient = useQueryClient();
  const { data: blocked } = useBlocked();
  const [error, setError] = useState<string | null>(null);
  if (!blocked?.length) return null;
  const unblock = async (userId: string) => {
    setError(null);
    try {
      await setBlocked(queryClient, userId, false);
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <section className="card blocked-section">
      <h3>Blocked people</h3>
      <p className="muted small">
        No direct messages either way, and no mention or reply alerts from them.
      </p>
      <ul className="user-list table two">
        <ListHead columns={["Person", ""]} />
        {blocked.map((u) => (
          <li key={u.id} className="user-row">
            <div className="user-row-main">
              <strong className="user-row-name">
                <Avatar
                  name={u.displayName || u.username}
                  fileId={u.avatarFileId}
                  size="small"
                />
                {u.displayName || u.username}
              </strong>
              <span className="muted small">@{u.username}</span>
            </div>
            <div className="user-row-actions">
              <button
                type="button"
                className="chip"
                onClick={() => unblock(u.id)}
              >
                Unblock
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
