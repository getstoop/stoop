import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { integrationsClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import {
  absoluteHookUrl,
  canNotifyEveryone,
  hookCanText,
} from "../../api/integrations";
import { serverOrigin } from "../../api/origin";
import { lastUsedText } from "../../api/tokenOptions";
import type { IncomingWebhook } from "../../gen/stoop/integrations/v1/webhook_pb";
import { confirm, prompt } from "../../stores/dialogs";
import type { Secret } from "./SecretModal";

// One incoming webhook under its bot: where it posts, what it may do, its
// fingerprint, and (for an instance admin) the controls.
export function IncomingRow({
  hook,
  channelName,
  manage,
  onSecret,
}: {
  hook: IncomingWebhook;
  channelName: string;
  manage: boolean;
  onSecret: (secret: Secret) => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: ["webhooks"] });
      await queryClient.invalidateQueries({ queryKey: ["bots"] });
      await queryClient.invalidateQueries({
        queryKey: ["members", hook.spaceId],
      });
    } catch (err) {
      setError(errorText(err));
    }
  };

  const rename = async () => {
    const next = await prompt({
      title: "Rename this webhook",
      label: "Name",
      initial: hook.name,
      action: "Rename",
    });
    if (next && next.trim() !== hook.name) {
      act(() =>
        integrationsClient.updateIncoming({ id: hook.id, name: next.trim() }),
      );
    }
  };
  const rotate = async () => {
    const ok = await confirm({
      title: `Rotate the URL for “${hook.name}”?`,
      body: "The old URL stops working straight away. You'll need to paste the new one into the sender.",
      action: "Rotate",
      danger: true,
    });
    if (!ok) return;
    act(async () => {
      const res = await integrationsClient.rotateSecret({ id: hook.id });
      onSecret({
        kind: "hook",
        name: hook.name,
        url: absoluteHookUrl(res.url, serverOrigin() || window.location.origin),
      });
    });
  };
  const remove = async () => {
    const ok = await confirm({
      title: `Delete “${hook.name}”?`,
      body: "Its URL stops working. The bot stays unless this was the last thing it had.",
      action: "Delete",
      danger: true,
    });
    if (ok) act(() => integrationsClient.deleteWebhook({ id: hook.id }));
  };

  return (
    <div className="bot-credential-row" data-hook={hook.name}>
      <strong>{hook.name}</strong>
      <span>
        posts into #{channelName}
        {" · "}
        {manage ? (
          <label className="toggle-row">
            <input
              type="checkbox"
              name={`notify-${hook.id}`}
              checked={canNotifyEveryone(hook)}
              disabled={!hook.enabled}
              onChange={(e) =>
                act(() =>
                  integrationsClient.updateIncoming({
                    id: hook.id,
                    notifyEveryone: e.target.checked,
                  }),
                )
              }
            />
            <span>may notify everyone</span>
          </label>
        ) : (
          hookCanText(hook)
        )}
        {hook.hint && <span className="muted"> · …{hook.hint}</span>}
        {!hook.enabled && (
          <span className="hook-disabled"> · off: {hook.disabledReason}</span>
        )}
      </span>
      <span className="muted">
        {lastUsedText(hook.lastUsedAt && timestampDate(hook.lastUsedAt))}
      </span>
      {manage ? (
        <div className="user-row-actions">
          <button type="button" className="chip" onClick={rename}>
            Rename
          </button>
          <button
            type="button"
            className="chip"
            onClick={() =>
              act(() =>
                integrationsClient.updateIncoming({
                  id: hook.id,
                  enabled: !hook.enabled,
                }),
              )
            }
          >
            {hook.enabled ? "Turn off" : "Turn on"}
          </button>
          <button type="button" className="chip" onClick={rotate}>
            Rotate URL
          </button>
          <button type="button" className="chip danger" onClick={remove}>
            Delete
          </button>
        </div>
      ) : (
        <span />
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
