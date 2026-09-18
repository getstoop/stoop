import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { chatClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { canManageMembers } from "../../api/permissions";
import {
  DataTable,
  PersonCell,
  type TableColumn,
} from "../../components/DataTable";
import type { Ban } from "../../gen/stoop/chat/v1/chat_pb";
import type { Space } from "../../gen/stoop/chat/v1/space_pb";

// Who's banned from the space, with the reason if one was given. Only
// people who manage members see it; unbanning lets them join again by
// any invite.
export function BansSection({ space }: { space: Space }) {
  const queryClient = useQueryClient();
  const [failed, setFailed] = useState<{ userId: string; text: string } | null>(
    null,
  );
  const { data: bans } = useQuery({
    queryKey: ["bans", space.id],
    queryFn: async () =>
      (await chatClient.listBans({ spaceId: space.id })).bans,
    enabled: canManageMembers(space),
  });

  const columns = useMemo<TableColumn<Ban>[]>(() => {
    const unban = async (userId: string) => {
      setFailed(null);
      try {
        await chatClient.unbanMember({ spaceId: space.id, userId });
        await queryClient.invalidateQueries({ queryKey: ["bans", space.id] });
      } catch (err) {
        setFailed({ userId, text: errorText(err) });
      }
    };
    return [
      {
        id: "person",
        header: "Person",
        accessorFn: (b) => b.user?.displayName || b.user?.username || "",
        cell: ({ row: { original: b } }) => (
          <PersonCell
            name={b.user?.displayName ?? ""}
            username={b.user?.username ?? "?"}
            avatarFileId={b.user?.avatarFileId}
            kind={b.user?.kind}
          />
        ),
      },
      {
        id: "reason",
        header: "Reason",
        enableSorting: false,
        meta: { width: "40%" },
        cell: ({ row: { original: b } }) => b.reason,
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { width: 110, actions: true },
        cell: ({ row: { original: b } }) => (
          <button
            type="button"
            className="chip"
            onClick={() => b.user && unban(b.user.id)}
          >
            Unban
          </button>
        ),
      },
    ];
  }, [queryClient, space.id]);

  if (!canManageMembers(space)) return null;
  return (
    <section className="card bans-section">
      <h3>Banned</h3>
      <p className="hint">
        Banned people are refused by every invite link. Unbanning lets them back
        in with any link, but doesn't re-add them.
      </p>
      <DataTable
        rows={bans}
        columns={columns}
        rowId={(b) => b.user?.id ?? ""}
        search={{
          placeholder: "Filter by name or @username",
          label: "Filter banned people",
          text: (b) => `${b.user?.displayName} @${b.user?.username}`,
        }}
        noun={["person", "people"]}
        empty="Nobody is banned from this space."
        rowError={(b) =>
          failed && failed.userId === b.user?.id ? failed.text : null
        }
      />
    </section>
  );
}
