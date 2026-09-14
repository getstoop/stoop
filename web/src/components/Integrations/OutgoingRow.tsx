import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { integrationsClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { eventLabel, hostOf } from "../../api/integrations";
import type { OutgoingWebhook } from "../../gen/stoop/integrations/v1/webhook_pb";
import { confirm } from "../../stores/dialogs";
import { DeliveryLog } from "./DeliveryLog";
import type { Secret } from "./SecretModal";

// One outgoing webhook: where it sends, what, from which channel, and
// (for an instance admin) the controls and the delivery log.
export function OutgoingRow({
  hook,
  channelName,
  manage,
  onEdit,
  onSecret,
}: {
  hook: OutgoingWebhook;
  channelName?: string;
  manage: boolean;
  onEdit: (hook: OutgoingWebhook) => void;
  onSecret: (secret: Secret) => void;
}) {
  const queryClient = useQueryClient();
  const [log, setLog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: ["webhooks"] });
      await queryClient.invalidateQueries({
        queryKey: ["deliveries", hook.id],
      });
    } catch (err) {
      setError(errorText(err));
    }
  };

  const test = () =>
    act(async () => {
      await integrationsClient.testWebhook({ id: hook.id });
      setLog(true);
    });
  const rotate = async () => {
    const ok = await confirm({
      title: `Rotate the signing secret for “${hook.name}”?`,
      body: "Deliveries are signed with the new secret from now on; update the receiver.",
      action: "Rotate",
      danger: true,
    });
    if (!ok) return;
    act(async () => {
      const res = await integrationsClient.rotateSecret({ id: hook.id });
      onSecret({ kind: "signing", name: hook.name, secret: res.secret });
    });
  };
  const remove = async () => {
    const ok = await confirm({
      title: `Delete “${hook.name}”?`,
      body: "Nothing more is sent to it, and its delivery log goes too.",
      action: "Delete",
      danger: true,
    });
    if (ok) act(() => integrationsClient.deleteWebhook({ id: hook.id }));
  };

  return (
    <>
      <li
        className={`user-row ${hook.enabled ? "" : "inactive"}`}
        data-outgoing={hook.name}
      >
        <div className="user-row-main">
          <strong>{hook.name}</strong>
          <span className="muted small">
            {manage ? hook.url : hostOf(hook.url)}
          </span>
        </div>
        <span className="user-cell">
          {hook.eventTypes.map(eventLabel).join(", ")}
          {" · from "}
          {hook.channelId ? `#${channelName ?? "a channel"}` : "every channel"}
        </span>
        <span className="user-cell">
          {hook.enabled ? (
            `${hook.sequence.toString()} sent`
          ) : (
            <span className="hook-disabled">Off: {hook.disabledReason}</span>
          )}
        </span>
        {manage ? (
          <div className="user-row-actions">
            <button type="button" className="chip" onClick={test}>
              Test
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => setLog(!log)}
              aria-expanded={log}
            >
              {log ? "Hide log" : "Log"}
            </button>
            <button type="button" className="chip" onClick={() => onEdit(hook)}>
              Edit
            </button>
            <button
              type="button"
              className="chip"
              onClick={() =>
                act(() =>
                  integrationsClient.updateOutgoing({
                    id: hook.id,
                    enabled: !hook.enabled,
                  }),
                )
              }
            >
              {hook.enabled ? "Turn off" : "Turn on"}
            </button>
            <button type="button" className="chip" onClick={rotate}>
              Rotate secret
            </button>
            <button type="button" className="chip danger" onClick={remove}>
              Delete
            </button>
          </div>
        ) : (
          <span />
        )}
        {error && <p className="error">{error}</p>}
      </li>
      {log && <DeliveryLog webhookId={hook.id} />}
    </>
  );
}
