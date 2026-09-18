import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { chatClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { useAdminSpaces } from "../../api/queries";
import { DataTable, type TableColumn } from "../../components/DataTable";
import { DeletedMark } from "../../components/DeletedMark";
import { DotsMenu } from "../../components/DotsMenu";
import { SpaceIcon } from "../../components/SpaceIcon";
import type { SpaceSummary } from "../../gen/stoop/chat/v1/space_pb";
import { confirm, prompt } from "../../stores/dialogs";

const ownerName = (s: SpaceSummary) => s.ownerDisplayName || s.ownerUsername;

// Every space on the server, so a server admin can reach one they never
// joined: inheriting admin is a permission check, not a membership row,
// and a space they aren't in is nowhere in their rail. Joining enters as
// a plain member; deleting is the space's own dialog.
export function SpacesSection() {
  const { data: spaces } = useAdminSpaces();
  const queryClient = useQueryClient();
  const [failed, setFailed] = useState<{ id: string; text: string } | null>(
    null,
  );

  const join = async (space: SpaceSummary) => {
    const ok = await confirm({
      title: `Join ${space.name}?`,
      body: "You join as a member, and the space sees you arrive.",
      action: "Join",
    });
    if (!ok) return;
    setFailed(null);
    try {
      await chatClient.joinSpace({ spaceId: space.id });
      await queryClient.invalidateQueries({ queryKey: ["spaces"] });
    } catch (err) {
      setFailed({ id: space.id, text: errorText(err) });
    }
  };

  const remove = async (space: SpaceSummary) => {
    const typed = await prompt({
      title: "Delete this space",
      body: `This deletes ${space.name} and everything in it. Type the space name to confirm.`,
      label: "Space name",
      match: space.name,
      action: "Delete space",
      danger: true,
    });
    if (typed !== space.name) return;
    setFailed(null);
    try {
      await chatClient.deleteSpace({ spaceId: space.id });
      await queryClient.invalidateQueries({ queryKey: ["spaces"] });
    } catch (err) {
      setFailed({ id: space.id, text: errorText(err) });
    }
  };

  // The columns are built once; the handlers they call reach this
  // render through a ref.
  const actions = useRef({ join, remove });
  actions.current = { join, remove };

  const columns = useMemo<TableColumn<SpaceSummary>[]>(
    () => [
      {
        id: "space",
        header: "Space",
        accessorFn: (s) => s.name,
        cell: ({ row: { original: s } }) => <SpaceCell space={s} />,
      },
      {
        id: "owner",
        header: "Owner",
        accessorFn: ownerName,
        meta: { width: "22%" },
        cell: ({ row: { original: s } }) => (
          <>
            {ownerName(s) || "Unknown"}
            <DeletedMark deleted={s.ownerDeleted} />
          </>
        ),
      },
      {
        id: "members",
        header: "Members",
        accessorFn: (s) => s.memberCount,
        meta: { width: "13%", align: "end" },
        cell: ({ row: { original: s } }) => s.memberCount,
      },
      {
        id: "created",
        header: "Created",
        accessorFn: (s) =>
          s.createdAt ? timestampDate(s.createdAt).getTime() : 0,
        meta: { width: "15%" },
        cell: ({ row: { original: s } }) =>
          s.createdAt && timestampDate(s.createdAt).toLocaleDateString(),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { width: 150, actions: true },
        cell: ({ row: { original: s } }) => (
          <>
            {s.viewerIsMember ? (
              <Link
                to="/s/$spaceId"
                params={{ spaceId: s.id }}
                className="chip"
              >
                Open
              </Link>
            ) : (
              <button
                type="button"
                className="chip"
                onClick={() => actions.current.join(s)}
              >
                Join
              </button>
            )}
            <DotsMenu
              label={`Actions for ${s.name}`}
              items={[
                {
                  label: "Delete space",
                  danger: true,
                  onSelect: () => actions.current.remove(s),
                },
              ]}
            />
          </>
        ),
      },
    ],
    [],
  );

  return (
    <section className="card">
      <h3>Spaces</h3>
      <DataTable
        rows={spaces}
        columns={columns}
        rowId={(s) => s.id}
        search={{
          placeholder: "Filter by space or owner",
          label: "Filter spaces",
          text: (s) => `${s.name} ${s.ownerDisplayName} @${s.ownerUsername}`,
        }}
        noun={["space", "spaces"]}
        empty="No spaces on this server yet."
        rowError={(s) => (failed && failed.id === s.id ? failed.text : null)}
        rowProps={(s) => ({ "data-space": s.name })}
      />
    </section>
  );
}

function SpaceCell({ space }: { space: SpaceSummary }) {
  return (
    <div className="dt-space">
      <span className="dt-space-icon">
        <SpaceIcon name={space.name} fileId={space.iconFileId} />
      </span>
      <div>
        {/* No "joined" badge: the row's Open or Join already says it. */}
        <strong>{space.name}</strong>
        <span className="dt-subline muted small">
          {space.description || "—"}
        </span>
      </div>
    </div>
  );
}
