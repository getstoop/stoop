import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { instanceClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { useInstanceUsers } from "../../api/queries";
import { AddToSpaceModal } from "../../components/AddToSpaceModal";
import { DotsMenu, type MenuItem } from "../../components/DotsMenu";
import { ListHead } from "../../components/ListHead";
import { InstanceRole } from "../../gen/stoop/auth/v1/auth_pb";
import type { InstanceUser } from "../../gen/stoop/instance/v1/user_pb";
import { confirm, notice, prompt } from "../../stores/dialogs";

export function UsersSection({ meId }: { meId: string }) {
  const queryClient = useQueryClient();
  const { data: users, isLoading } = useInstanceUsers(true);
  const [error, setError] = useState<string | null>(null);
  // Client-side filter: the list is already fully loaded, and a homelab
  // has tens of accounts, not thousands.
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? users?.filter(
        (u) =>
          u.username.toLowerCase().includes(needle) ||
          u.displayName.toLowerCase().includes(needle),
      )
    : users;

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: ["instance-users"] });
    } catch (err) {
      setError(errorText(err));
    }
  };
  const toggleRole = (u: InstanceUser) =>
    act(() =>
      instanceClient.setUserRole({
        userId: u.id,
        role:
          u.role === InstanceRole.ADMIN
            ? InstanceRole.MEMBER
            : InstanceRole.ADMIN,
      }),
    );
  const [tempPassword, setTempPassword] = useState<{
    username: string;
    password: string;
  } | null>(null);
  const resetPassword = async (u: InstanceUser) => {
    const ok = await confirm({
      title: `Reset @${u.username}'s password?`,
      body: "They'll be signed out everywhere and get a temporary password you'll need to pass on.",
      action: "Reset password",
      danger: true,
    });
    if (!ok) return;
    act(async () => {
      const res = await instanceClient.resetUserPassword({ userId: u.id });
      setTempPassword({
        username: u.username,
        password: res.temporaryPassword,
      });
    });
  };
  const renameHandle = async (u: InstanceUser) => {
    const next = await prompt({
      title: `Change @${u.username}'s username`,
      body: "3-32 of a-z, 0-9, _. Mentions of the old handle keep working by id, but people know them by this.",
      label: "Username",
      initial: u.username,
      action: "Rename",
    });
    if (next === null || next.trim() === u.username) return;
    act(() =>
      instanceClient.renameUser({ userId: u.id, username: next.trim() }),
    );
  };
  const renameDisplay = async (u: InstanceUser) => {
    const next = await prompt({
      title: `Change ${u.displayName || u.username}'s display name`,
      label: "Display name",
      initial: u.displayName,
      action: "Save",
    });
    if (next === null || next.trim() === u.displayName) return;
    act(() =>
      instanceClient.renameUser({ userId: u.id, displayName: next.trim() }),
    );
  };
  // Clearing only: an admin takes down a slur, and nobody needs an admin
  // authoring someone's self-description. The confirm quotes the text
  // because this page deliberately doesn't list bios — an operational
  // list is not the place to read everyone's — so this is where an admin
  // sees what they are removing. No undo and no record (STOOP-121).
  const clearProfile = async (
    u: InstanceUser,
    field: "pronouns" | "bio",
    value: string,
  ) => {
    const ok = await confirm({
      title: `Clear ${u.displayName || `@${u.username}`}'s ${field}?`,
      body: `“${value}” will be removed. They can set it again from their profile page.`,
      action: "Clear",
      danger: true,
    });
    if (!ok) return;
    act(() =>
      instanceClient.clearUserProfile({
        userId: u.id,
        pronouns: field === "pronouns",
        bio: field === "bio",
      }),
    );
  };
  const [addingTo, setAddingTo] = useState<InstanceUser | null>(null);
  const toggleFrozen = (u: InstanceUser) =>
    act(() =>
      instanceClient.setUsernameFrozen({
        userId: u.id,
        frozen: !u.usernameFrozen,
      }),
    );
  const toggleActive = async (u: InstanceUser) => {
    const deactivating = !u.deactivatedAt;
    if (
      deactivating &&
      !(await confirm({
        title: `Deactivate @${u.username}?`,
        body: "They'll be signed out everywhere and can't log in until reactivated.",
        action: "Deactivate",
        danger: true,
      }))
    ) {
      return;
    }
    act(() =>
      instanceClient.setUserActive({ userId: u.id, active: !deactivating }),
    );
  };

  // A deactivated account can only be reactivated; everything else
  // waits until it is.
  const actionsFor = (u: InstanceUser): MenuItem[] => {
    if (u.deactivatedAt) {
      return [{ label: "Reactivate", onSelect: () => toggleActive(u) }];
    }
    const admin = u.role === InstanceRole.ADMIN;
    const items: MenuItem[] = [
      {
        label: "Add to space",
        onSelect: () => setAddingTo(u),
        title: "Put them in one of your spaces, no invite needed",
      },
      {
        label: admin ? "Remove admin" : "Make admin",
        onSelect: () => toggleRole(u),
      },
      {
        label: "Change username",
        onSelect: () => renameHandle(u),
        title: "Change their @username",
      },
      {
        label: "Change display name",
        onSelect: () => renameDisplay(u),
      },
    ];
    if (u.pronouns) {
      items.push({
        label: "Clear pronouns",
        onSelect: () => clearProfile(u, "pronouns", u.pronouns),
        title: "Remove their pronouns",
      });
    }
    if (u.bio) {
      items.push({
        label: "Clear bio",
        onSelect: () => clearProfile(u, "bio", u.bio),
        title: "Remove their bio",
      });
    }
    if (!admin) {
      items.push({
        label: u.usernameFrozen ? "Unfreeze username" : "Freeze username",
        onSelect: () => toggleFrozen(u),
        title: "Lock or unlock their @username against renames",
      });
    }
    items.push(
      {
        label: "Reset password",
        onSelect: () => resetPassword(u),
        title: "Set a temporary password and sign them out everywhere",
      },
      { label: "Deactivate", onSelect: () => toggleActive(u), danger: true },
    );
    return items;
  };

  return (
    <section className="card accounts-section">
      <h3>Accounts</h3>
      {isLoading && <p className="muted">Loading…</p>}
      {users && users.length > 0 && (
        <div className="user-filter">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name or @username"
            aria-label="Filter accounts"
          />
          <span className="muted small">
            {shown?.length === users.length
              ? `${users.length} account${users.length === 1 ? "" : "s"}`
              : `${shown?.length ?? 0} of ${users.length}`}
          </span>
        </div>
      )}
      {shown && shown.length === 0 && needle && (
        <p className="muted small">No accounts match “{query.trim()}”.</p>
      )}
      <ul className="user-list table four">
        <ListHead columns={["Person", "Role", "Joined", ""]} />
        {shown?.map((u) => {
          const self = u.id === meId;
          const inactive = !!u.deactivatedAt;
          return (
            <li key={u.id} className={`user-row ${inactive ? "inactive" : ""}`}>
              <div className="user-row-main">
                <strong>{u.displayName || u.username}</strong>
                <span className="muted small">
                  @{u.username}
                  {u.pronouns && <> · {u.pronouns}</>}
                  {inactive && <span className="badge">deactivated</span>}
                  {u.usernameFrozen && (
                    <span className="badge">name frozen</span>
                  )}
                </span>
              </div>
              <span className="user-cell">
                {u.role === InstanceRole.ADMIN ? (
                  <span className="badge">admin</span>
                ) : (
                  "Member"
                )}
              </span>
              <span className="user-cell">
                {u.createdAt && timestampDate(u.createdAt).toLocaleDateString()}
              </span>
              {!self && (
                <div className="user-row-actions">
                  <DotsMenu
                    label={`Actions for @${u.username}`}
                    items={actionsFor(u)}
                  />
                </div>
              )}
              {self && <span className="muted small">you</span>}
            </li>
          );
        })}
      </ul>
      {tempPassword && (
        <div className="temp-password" role="status">
          <p>
            Temporary password for <strong>@{tempPassword.username}</strong> —
            pass it on now; it isn't shown again. They've been signed out
            everywhere and should change it on their profile page.
          </p>
          <div className="card-row">
            <code>{tempPassword.password}</code>
            <button
              type="button"
              className="chip"
              onClick={() =>
                navigator.clipboard?.writeText(tempPassword.password)
              }
            >
              Copy
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => setTempPassword(null)}
            >
              Done
            </button>
          </div>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {addingTo && (
        <AddToSpaceModal
          user={addingTo}
          onClose={() => setAddingTo(null)}
          onAdded={(spaceName) => {
            const who = addingTo.displayName || `@${addingTo.username}`;
            setAddingTo(null);
            notice({ title: `Added ${who} to ${spaceName}.` });
          }}
        />
      )}
    </section>
  );
}
