import { useMemo, useRef } from "react";
import { eventLabel, hostOf } from "../../api/integrations";
import {
  DataTable,
  StateCell,
  type TableColumn,
} from "../../components/DataTable";
import { DotsMenu } from "../../components/DotsMenu";
import { DeliveryLog } from "../../components/Integrations/DeliveryLog";
import type { Secret } from "../../components/Integrations/SecretModal";
import { useOutgoingActions } from "../../components/Integrations/useOutgoingActions";
import type { OutgoingWebhook } from "../../gen/stoop/integrations/v1/webhook_pb";

// Where this space's events go. An instance admin gets the controls and,
// under each row, its delivery log.
export function OutgoingTable({
  hooks,
  channelName,
  manage,
  onEdit,
  onSecret,
}: {
  hooks: OutgoingWebhook[] | undefined;
  channelName: (id: string) => string;
  manage: boolean;
  onEdit: (hook: OutgoingWebhook) => void;
  onSecret: (secret: Secret) => void;
}) {
  const actions = useOutgoingActions(onSecret);
  const view = { channelName, actions, onEdit };
  const latest = useRef(view);
  latest.current = view;

  const columns = useMemo<TableColumn<OutgoingWebhook>[]>(() => {
    const cols: TableColumn<OutgoingWebhook>[] = [
      {
        id: "webhook",
        header: "Webhook",
        accessorFn: (h) => h.name,
        meta: { width: "28%" },
        cell: ({ row: { original: h } }) => (
          <>
            <strong>{h.name}</strong>
            <span className="dt-truncate muted small" title={h.url}>
              {manage ? h.url : hostOf(h.url)}
            </span>
          </>
        ),
      },
      {
        id: "sends",
        header: "Sends",
        enableSorting: false,
        cell: ({ row: { original: h } }) => (
          <>
            {h.eventTypes.map(eventLabel).join(", ")}
            <span className="dt-subline small">
              from{" "}
              {h.channelId
                ? `#${latest.current.channelName(h.channelId)}`
                : "every channel"}
            </span>
          </>
        ),
      },
      {
        id: "state",
        header: "State",
        accessorFn: (h) => (h.enabled ? 0 : 1),
        meta: { width: "22%" },
        cell: ({ row: { original: h } }) => (
          <StateCell
            on={h.enabled}
            note={`${h.sequence.toString()} sent`}
            reason={h.disabledReason}
          />
        ),
      },
    ];
    if (manage) {
      cols.push({
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { width: 190, actions: true },
        cell: ({ row: { original: h } }) => {
          const { actions: a, onEdit: edit } = latest.current;
          return (
            <>
              <button type="button" className="chip" onClick={() => a.test(h)}>
                Test
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => a.toggle(h)}
              >
                {h.enabled ? "Turn off" : "Turn on"}
              </button>
              <DotsMenu
                label={`Actions for ${h.name}`}
                items={[
                  { label: "Edit", onSelect: () => edit(h) },
                  { label: "Rotate secret", onSelect: () => a.rotate(h) },
                  {
                    label: "Delete",
                    danger: true,
                    onSelect: () => a.remove(h),
                  },
                ]}
              />
            </>
          );
        },
      });
    }
    return cols;
  }, [manage]);

  return (
    <DataTable
      rows={hooks}
      columns={columns}
      rowId={(h) => h.id}
      noun={["webhook", "webhooks"]}
      empty="Nothing is sent out of this space."
      rowInactive={(h) => !h.enabled}
      rowError={(h) =>
        actions.failed && actions.failed.id === h.id
          ? actions.failed.text
          : null
      }
      rowProps={(h) => ({ "data-outgoing": h.name })}
      detail={
        manage
          ? {
              canExpand: () => true,
              label: (h) => `Delivery log for ${h.name}`,
              render: (h) => <DeliveryLog webhookId={h.id} />,
              expanded: actions.openLogs,
              onExpandedChange: actions.setOpenLogs,
            }
          : undefined
      }
    />
  );
}
