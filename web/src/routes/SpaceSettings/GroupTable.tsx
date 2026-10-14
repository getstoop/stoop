import { useMemo, useRef } from "react";
import { groupCount } from "../../api/groups";
import { DataTable, type TableColumn } from "../../components/DataTable";
import { DotsMenu } from "../../components/DotsMenu";
import { PeopleIcon } from "../../components/Icons";
import type { Group } from "../../gen/stoop/chat/v1/group_pb";
import type { Member } from "../../gen/stoop/chat/v1/member_pb";

// A space's groups: name and handle, who is in each, and a row menu.
export function GroupTable({
  groups,
  members,
  onEdit,
  onDelete,
  rowError,
}: {
  // undefined while loading.
  groups: Group[] | undefined;
  members: Member[];
  onEdit: (group: Group) => void;
  onDelete: (group: Group) => void;
  rowError: (group: Group) => string | null;
}) {
  // The cells read this render's members and handlers through a ref, so
  // the columns stay stable.
  const latest = useRef({ members, onEdit, onDelete });
  latest.current = { members, onEdit, onDelete };

  const columns = useMemo<TableColumn<Group>[]>(
    () => [
      {
        id: "group",
        header: "Group",
        accessorFn: (g) => g.name,
        cell: ({ row: { original: g } }) => (
          <div className="dt-person">
            <span className="group-mark" aria-hidden="true">
              <PeopleIcon />
            </span>
            <div>
              <strong>
                {g.name} <span className="muted">{groupCount(g)}</span>
              </strong>
              <span className="muted small">@@{g.handle}</span>
            </div>
          </div>
        ),
      },
      {
        id: "people",
        header: "People",
        enableSorting: false,
        cell: ({ row: { original: g } }) =>
          peopleText(g, latest.current.members),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { width: 64, actions: true },
        cell: ({ row: { original: g } }) => (
          <DotsMenu
            label={`Actions for @@${g.handle}`}
            items={[
              { label: "Edit", onSelect: () => latest.current.onEdit(g) },
              {
                label: "Delete",
                danger: true,
                onSelect: () => latest.current.onDelete(g),
              },
            ]}
          />
        ),
      },
    ],
    [],
  );

  return (
    <DataTable
      rows={groups}
      columns={columns}
      rowId={(g) => g.id}
      search={{
        placeholder: "Filter by name or @@handle",
        label: "Filter groups",
        text: (g) => `${g.name} @@${g.handle}`,
      }}
      noun={["group", "groups"]}
      empty="No groups yet."
      rowError={rowError}
      rowProps={(g) => ({ "data-group": g.handle })}
    />
  );
}

// "Ada Lovelace, Bea Okafor and 3 more", or "Nobody" once everyone in it
// has left the space.
function peopleText(group: Group, members: Member[]): string {
  const names = group.userIds.map((id) => {
    const member = members.find((m) => m.userId === id);
    return member ? member.displayName || member.username : "Someone";
  });
  if (names.length === 0) return "Nobody";
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}
