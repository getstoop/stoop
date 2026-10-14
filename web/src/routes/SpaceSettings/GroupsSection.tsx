import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorText } from "../../api/errors";
import { deleteGroup, useGroups } from "../../api/groups";
import { canManageMembers } from "../../api/permissions";
import { useMembers } from "../../api/queries";
import type { Group } from "../../gen/stoop/chat/v1/group_pb";
import type { Space } from "../../gen/stoop/chat/v1/space_pb";
import { confirm } from "../../stores/dialogs";
import { GroupModal } from "./GroupModal";
import { GroupTable } from "./GroupTable";

// Space settings → Groups: the sets of members @@handle mentions at once.
export function GroupsSection({ space }: { space: Space }) {
  const queryClient = useQueryClient();
  const { data: groups } = useGroups(space.id);
  const { data: members } = useMembers(space.id);
  // undefined: closed; null: New group; a group: Edit.
  const [editing, setEditing] = useState<Group | null | undefined>();
  // The last failed delete, shown on its row.
  const [failed, setFailed] = useState<{ id: string; text: string } | null>(
    null,
  );

  const remove = async (group: Group) => {
    const ok = await confirm({
      title: `Delete ${group.name}?`,
      body: `@@${group.handle} will stop notifying anyone. Messages that used it stay as they are.`,
      action: "Delete",
      danger: true,
    });
    if (!ok) return;
    setFailed(null);
    try {
      await deleteGroup(queryClient, group);
    } catch (err) {
      setFailed({ id: group.id, text: errorText(err) });
    }
  };

  if (!canManageMembers(space)) {
    return (
      <section className="card">
        <h3>Groups</h3>
        <p className="hint">Only the owner and admins can manage groups.</p>
      </section>
    );
  }
  return (
    <>
      <section className="card">
        <div className="groups-head">
          <h3>Groups</h3>
          <button
            type="button"
            className="chip"
            onClick={() => setEditing(null)}
          >
            New group
          </button>
        </div>
        <p className="hint">
          Mentioning a group notifies everyone in it, except in private
          channels.
        </p>
        <GroupTable
          groups={groups}
          members={members ?? []}
          onEdit={setEditing}
          onDelete={remove}
          rowError={(group) => (failed?.id === group.id ? failed.text : null)}
        />
      </section>
      {editing !== undefined && (
        <GroupModal
          spaceId={space.id}
          members={members ?? []}
          existing={editing ?? undefined}
          onClose={() => setEditing(undefined)}
        />
      )}
    </>
  );
}
