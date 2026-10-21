import { useMemo, useRef } from "react";
import { groupCount } from "../../api/groups";
import { CopyButton } from "../../components/CopyButton";
import { DataTable, type TableColumn } from "../../components/DataTable";
import { DotsMenu } from "../../components/DotsMenu";
import { PeopleIcon } from "../../components/Icons";
import { mentionToken } from "../../core/mentions";
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
        accessorFn: (group) => group.name,
        cell: ({ row: { original: group } }) => (
          <div className="dt-person">
            <span className="group-mark" aria-hidden="true">
              <PeopleIcon />
            </span>
            <div>
              <strong>
                {group.name} <span className="muted">{groupCount(group)}</span>
              </strong>
              <span className="muted small">@{group.handle}</span>
            </div>
            <CopyButton
              label="Copy mention"
              text={mentionToken({
                kind: "group",
                id: group.id,
                handle: group.handle,
              })}
            />
          </div>
        ),
      },
      {
        id: "people",
        header: "People",
        enableSorting: false,
        cell: ({ row: { original: group } }) =>
          peopleText(group, latest.current.members),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { width: 64, actions: true },
        cell: ({ row: { original: group } }) => (
          <DotsMenu
            label={`Actions for @${group.handle}`}
            items={[
              { label: "Edit", onSelect: () => latest.current.onEdit(group) },
              {
                label: "Delete",
                danger: true,
                onSelect: () => latest.current.onDelete(group),
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
      rowId={(group) => group.id}
      search={{
        placeholder: "Filter by name or @handle",
        label: "Filter groups",
        text: (group) => `${group.name} @${group.handle}`,
      }}
      noun={["group", "groups"]}
      empty="No groups yet."
      rowError={rowError}
      rowProps={(group) => ({ "data-group": group.handle })}
    />
  );
}

// "Ada Lovelace, Bea Okafor and 3 more", or "Nobody" once everyone in it
// has left the space.
function peopleText(group: Group, members: Member[]): string {
  const names = group.userIds.map((id) => {
    const member = members.find((candidate) => candidate.userId === id);
    return member ? member.displayName || member.username : "Someone";
  });
  if (names.length === 0) return "Nobody";
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}
