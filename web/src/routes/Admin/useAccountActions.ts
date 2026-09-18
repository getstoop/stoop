import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { instanceClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { isBot } from "../../api/identity";
import type { MenuItem } from "../../components/DotsMenu";
import { InstanceRole } from "../../gen/stoop/auth/v1/auth_pb";
import type { InstanceUser } from "../../gen/stoop/instance/v1/user_pb";
import { confirm, prompt } from "../../stores/dialogs";

// What a server admin can do to an account from its row in Accounts, and
// the state those actions leave behind: the row that failed, a temporary
// password to pass on, the account being added to a space.
export function useAccountActions(
  users: InstanceUser[] | undefined,
  meId: string,
) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [failed, setFailed] = useState<{ userId: string; text: string } | null>(
    null,
  );
  const act = async (u: InstanceUser, fn: () => Promise<unknown>) => {
    setFailed(null);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: ["instance-users"] });
    } catch (err) {
      setFailed({ userId: u.id, text: errorText(err) });
    }
  };
  const iOwn = users?.some((u) => u.id === meId && u.owner) ?? false;
  // Who may rename or clear whom: the owner over admins, admins over
  // members. The server holds the same rule.
  const rank = (u: InstanceUser) =>
    u.owner ? 2 : u.role === InstanceRole.ADMIN ? 1 : 0;
  const myRank = iOwn ? 2 : 1;
  const makeOwner = async (u: InstanceUser) => {
    const ok = await confirm({
      title: `Make @${u.username} the server owner?`,
      body: "Nobody can remove the owner as an admin. You'll be an ordinary admin, and only they can hand it back.",
      action: "Make owner",
      danger: true,
    });
    if (!ok) return;
    act(u, () => instanceClient.transferOwnership({ userId: u.id }));
  };
  const toggleRole = (u: InstanceUser) =>
    act(u, () =>
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
    act(u, async () => {
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
    act(u, () =>
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
    act(u, () =>
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
    act(u, () =>
      instanceClient.clearUserProfile({
        userId: u.id,
        pronouns: field === "pronouns",
        bio: field === "bio",
      }),
    );
  };
  const [addingTo, setAddingTo] = useState<InstanceUser | null>(null);
  const toggleFrozen = (u: InstanceUser) =>
    act(u, () =>
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
    act(u, () =>
      instanceClient.setUserActive({ userId: u.id, active: !deactivating }),
    );
  };

  // A deactivated account can only be reactivated; everything else
  // waits until it is. A bot has no password to reset, no username to
  // freeze and is never a server admin, and its spaces, tokens and
  // webhooks are managed under Integrations; the server refuses those
  // actions for a bot too.
  const actionsFor = (u: InstanceUser): MenuItem[] => {
    if (u.deactivatedAt) {
      return [{ label: "Reactivate", onSelect: () => toggleActive(u) }];
    }
    const admin = u.role === InstanceRole.ADMIN;
    const bot = isBot(u.kind);
    const items: MenuItem[] = [];
    // The owner can't be removed as an admin, reset or deactivated by
    // anyone; the items stay, greyed, to say why.
    const ownerOnly = u.owner
      ? { disabled: true, title: "The server owner; only they can hand it on" }
      : {};
    const outranked =
      rank(u) >= myRank
        ? {
            disabled: true,
            title: u.owner
              ? "Only the server owner changes their own profile"
              : "Only the server owner can change another admin's profile",
          }
        : {};
    if (bot) {
      items.push({
        label: "Manage integrations",
        onSelect: () =>
          navigate({ to: "/admin", search: { tab: "integrations" } }),
        title: "Its tokens, webhooks and spaces",
      });
    } else {
      items.push({
        label: "Add to space",
        onSelect: () => setAddingTo(u),
        title: "Put them in one of your spaces, no invite needed",
      });
    }
    if (!bot) {
      items.push({
        label: admin ? "Remove admin" : "Make admin",
        onSelect: () => toggleRole(u),
        ...ownerOnly,
      });
    }
    if (iOwn && admin && !bot) {
      items.push({
        label: "Make owner",
        onSelect: () => makeOwner(u),
        title: "Hand them the server; you stay an admin",
      });
    }
    items.push(
      {
        label: "Change username",
        onSelect: () => renameHandle(u),
        title: "Change their @username",
        ...outranked,
      },
      {
        label: "Change display name",
        onSelect: () => renameDisplay(u),
        ...outranked,
      },
    );
    if (u.pronouns) {
      items.push({
        label: "Clear pronouns",
        onSelect: () => clearProfile(u, "pronouns", u.pronouns),
        title: "Remove their pronouns",
        ...outranked,
      });
    }
    if (u.bio) {
      items.push({
        label: "Clear bio",
        onSelect: () => clearProfile(u, "bio", u.bio),
        title: "Remove their bio",
        ...outranked,
      });
    }
    if (!admin && !bot) {
      items.push({
        label: u.usernameFrozen ? "Unfreeze username" : "Freeze username",
        onSelect: () => toggleFrozen(u),
        title: "Lock or unlock their @username against renames",
      });
    }
    if (!bot) {
      items.push({
        label: "Reset password",
        onSelect: () => resetPassword(u),
        title: "Set a temporary password and sign them out everywhere",
        ...ownerOnly,
      });
    }
    items.push({
      label: "Deactivate",
      onSelect: () => toggleActive(u),
      danger: true,
      ...ownerOnly,
    });
    return items;
  };

  return {
    actionsFor,
    failed,
    tempPassword,
    clearTempPassword: () => setTempPassword(null),
    addingTo,
    doneAdding: () => setAddingTo(null),
  };
}
