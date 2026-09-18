import { useMemo } from "react";
import { eventLabel } from "../../api/integrations";
import { DataTable, type TableColumn } from "../../components/DataTable";
import type {
  IncomingWebhook,
  OutgoingWebhook,
} from "../../gen/stoop/integrations/v1/webhook_pb";

type SpaceRow = {
  id: string;
  name: string;
  incoming: number;
  outgoing: OutgoingWebhook[];
};

const columns: TableColumn<SpaceRow>[] = [
  {
    id: "space",
    header: "Space",
    accessorFn: (s) => s.name || s.id,
    meta: { width: "30%" },
    cell: ({ row: { original: s } }) => <strong>{s.name || s.id}</strong>,
  },
  {
    id: "webhooks",
    header: "Webhooks",
    accessorFn: (s) => s.incoming + s.outgoing.length,
    cell: ({ row: { original: s } }) => (
      <>
        {s.incoming} in, {s.outgoing.length} out
        {s.outgoing.map((h) => (
          <span key={h.id} className="dt-subline small">
            {h.name} → {h.url} ({h.eventTypes.map(eventLabel).join(", ")})
          </span>
        ))}
      </>
    ),
  },
];

// Every webhook on the server, counted by space, with where each
// outgoing one sends. They are changed from the space's own settings.
export function SpaceWebhooksTable({
  incoming,
  outgoing,
}: {
  incoming: IncomingWebhook[] | undefined;
  outgoing: OutgoingWebhook[] | undefined;
}) {
  const rows = useMemo(() => {
    if (!incoming || !outgoing) return undefined;
    const bySpace = new Map<string, SpaceRow>();
    const row = (id: string, name: string) => {
      let r = bySpace.get(id);
      if (!r) {
        r = { id, name, incoming: 0, outgoing: [] };
        bySpace.set(id, r);
      }
      return r;
    };
    for (const h of incoming) row(h.spaceId, h.spaceName).incoming++;
    for (const h of outgoing) row(h.spaceId, h.spaceName).outgoing.push(h);
    return [...bySpace.values()];
  }, [incoming, outgoing]);

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowId={(s) => s.id}
      noun={["space", "spaces"]}
      empty="No webhooks anywhere."
      rowProps={(s) => ({ "data-space": s.name })}
    />
  );
}
