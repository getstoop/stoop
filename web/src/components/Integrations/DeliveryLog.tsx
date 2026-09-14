import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { integrationsClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import {
  deliveryState,
  deliveryText,
  eventLabel,
} from "../../api/integrations";
import { useDeliveries } from "../../api/queries";

// An outgoing webhook's last ten deliveries: what, when, how it went, and
// the first line of the receiver's answer. A failed one can be sent again.
export function DeliveryLog({ webhookId }: { webhookId: string }) {
  const queryClient = useQueryClient();
  const { data: deliveries, isLoading } = useDeliveries(webhookId, true);
  const [error, setError] = useState<string | null>(null);

  const redeliver = async (id: string) => {
    setError(null);
    try {
      await integrationsClient.redeliverDelivery({ deliveryId: id });
      await queryClient.invalidateQueries({
        queryKey: ["deliveries", webhookId],
      });
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <li className="delivery-log" data-deliveries-of={webhookId}>
      {isLoading && <p className="muted small">Loading…</p>}
      {deliveries?.length === 0 && (
        <p className="muted small">Nothing sent yet.</p>
      )}
      {deliveries?.map((d) => {
        const state = deliveryState(d);
        return (
          <div key={d.id} className={`delivery-row ${state}`}>
            <span>
              <strong>{eventLabel(d.eventType)}</strong>
              <br />
              <span className="muted">
                #{d.sequence.toString()} ·{" "}
                {d.createdAt && timestampDate(d.createdAt).toLocaleString()}
              </span>
            </span>
            <span>
              {deliveryText(d)}
              {d.response && (
                <>
                  <br />
                  <span className="response">{d.response.split("\n")[0]}</span>
                </>
              )}
            </span>
            {state === "failed" ? (
              <button
                type="button"
                className="chip"
                onClick={() => redeliver(d.id)}
              >
                Send again
              </button>
            ) : (
              <span />
            )}
          </div>
        );
      })}
      {error && <p className="error">{error}</p>}
    </li>
  );
}
