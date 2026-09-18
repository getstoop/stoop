import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { setBlocked, useBlocked } from "../../api/blocks";
import { errorText } from "../../api/errors";
import {
  DataTable,
  PersonCell,
  type TableColumn,
} from "../../components/DataTable";
import type { MessageAuthor } from "../../gen/stoop/chat/v1/message_pb";

// People you've blocked. Hidden until there's someone in it; the card
// that blocked them may be hard to find again, so undo lives here.
export function BlockedSection() {
  const queryClient = useQueryClient();
  const { data: blocked } = useBlocked();
  const [failed, setFailed] = useState<{ id: string; text: string } | null>(
    null,
  );
  const unblock = async (userId: string) => {
    setFailed(null);
    try {
      await setBlocked(queryClient, userId, false);
    } catch (err) {
      setFailed({ id: userId, text: errorText(err) });
    }
  };
  const latest = useRef(unblock);
  latest.current = unblock;
  const columns = useMemo<TableColumn<MessageAuthor>[]>(
    () => [
      {
        id: "person",
        header: "Person",
        accessorFn: (u) => u.displayName || u.username,
        cell: ({ row: { original: u } }) => (
          <PersonCell
            name={u.displayName}
            username={u.username}
            avatarFileId={u.avatarFileId}
          />
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { width: 110, actions: true },
        cell: ({ row: { original: u } }) => (
          <button
            type="button"
            className="chip"
            onClick={() => latest.current(u.id)}
          >
            Unblock
          </button>
        ),
      },
    ],
    [],
  );
  if (!blocked?.length) return null;
  return (
    <section className="card blocked-section">
      <h3>Blocked people</h3>
      <p className="muted small">
        No direct messages either way, and no mention or reply alerts from them.
      </p>
      <DataTable
        rows={blocked}
        columns={columns}
        rowId={(u) => u.id}
        noun={["person", "people"]}
        empty="You haven't blocked anyone."
        rowError={(u) => (failed && failed.id === u.id ? failed.text : null)}
      />
    </section>
  );
}
