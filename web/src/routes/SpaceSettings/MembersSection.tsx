import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { chatClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { canActOn, canManageMembers, roleLabel } from "../../api/permissions";
import { useMe, useMembers } from "../../api/queries";
import {
  DataTable,
  PersonCell,
  type TableColumn,
} from "../../components/DataTable";
import { DotsMenu, type MenuItem } from "../../components/DotsMenu";
import { InstanceRole } from "../../gen/stoop/auth/v1/auth_pb";
import type { Member } from "../../gen/stoop/chat/v1/member_pb";
import { type Space, SpaceRole } from "../../gen/stoop/chat/v1/space_pb";
import { confirm } from "../../stores/dialogs";

export function MembersSection({ space }: { space: Space }) {
  const queryClient = useQueryClient();
  const { data: members } = useMembers(space.id);
  const { data: me } = useMe();
  // The last failed action, shown on the row it was for.
  const [failed, setFailed] = useState<{ userId: string; text: string } | null>(
    null,
  );
  const viewerIsInstanceAdmin = me?.role === InstanceRole.ADMIN;
  const myId = me?.id;

  const act = useCallback(
    async (m: Member, fn: () => Promise<unknown>) => {
      setFailed(null);
      try {
        await fn();
        await queryClient.invalidateQueries({
          queryKey: ["members", space.id],
        });
      } catch (err) {
        setFailed({ userId: m.userId, text: errorText(err) });
      }
    },
    [queryClient, space.id],
  );

  const columns = useMemo<TableColumn<Member>[]>(() => {
    const setRole = (m: Member, role: SpaceRole) =>
      act(m, () =>
        chatClient.setMemberRole({ spaceId: space.id, userId: m.userId, role }),
      );
    const kick = async (m: Member) => {
      const ok = await confirm({
        title: `Remove ${m.displayName || m.username} from ${space.name}?`,
        action: "Remove",
        danger: true,
      });
      if (!ok) return;
      act(m, () =>
        chatClient.kickMember({ spaceId: space.id, userId: m.userId }),
      );
    };
    const ban = async (m: Member) => {
      const ok = await confirm({
        title: `Ban ${m.displayName || m.username} from ${space.name}?`,
        body: "They'll be removed and can't come back until unbanned.",
        action: "Ban",
        danger: true,
      });
      if (!ok) return;
      act(m, async () => {
        await chatClient.banMember({ spaceId: space.id, userId: m.userId });
        await queryClient.invalidateQueries({ queryKey: ["bans", space.id] });
      });
    };
    const actionsFor = (m: Member): MenuItem[] => [
      m.role === SpaceRole.MEMBER
        ? { label: "Make admin", onSelect: () => setRole(m, SpaceRole.ADMIN) }
        : {
            label: "Remove admin",
            onSelect: () => setRole(m, SpaceRole.MEMBER),
          },
      {
        label: "Kick",
        title: "Remove now; they can come back with any invite link",
        danger: true,
        onSelect: () => kick(m),
      },
      {
        label: "Ban",
        title: "Remove and refuse every invite link until unbanned",
        danger: true,
        onSelect: () => ban(m),
      },
    ];
    return [
      {
        id: "person",
        header: "Person",
        accessorFn: (m) => m.displayName || m.username,
        cell: ({ row: { original: m } }) => (
          <PersonCell
            name={m.displayName}
            username={m.username}
            avatarFileId={m.avatarFileId}
            kind={m.kind}
            badges={m.userId === myId && <span className="badge">you</span>}
          />
        ),
      },
      {
        id: "role",
        header: "Role",
        // Owner first: sorted by rank, not by the word.
        accessorFn: (m) => -m.role,
        meta: { width: "30%" },
        cell: ({ row: { original: m } }) => (
          <>
            {capitalize(roleLabel(m.role))}
            {m.instanceAdmin && <span className="badge">server admin</span>}
          </>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { width: 64, actions: true },
        cell: ({ row: { original: m } }) =>
          m.userId !== myId &&
          canActOn(space, viewerIsInstanceAdmin, m.role) && (
            <DotsMenu
              label={`Actions for @${m.username}`}
              items={actionsFor(m)}
            />
          ),
      },
    ];
  }, [act, queryClient, space, myId, viewerIsInstanceAdmin]);

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
      <DataTable
        rows={members}
        columns={columns}
        rowId={(m) => m.userId}
        search={{
          placeholder: "Filter by name or @username",
          label: "Filter members",
          text: (m) => `${m.displayName} @${m.username}`,
        }}
        noun={["member", "members"]}
        empty="No members yet."
        rowError={(m) => (failed?.userId === m.userId ? failed.text : null)}
        rowProps={(m) => ({ "data-member": m.username })}
      />
    </section>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
