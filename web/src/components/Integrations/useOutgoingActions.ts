import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { integrationsClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import type { OutgoingWebhook } from "../../gen/stoop/integrations/v1/webhook_pb";
import { confirm } from "../../stores/dialogs";
import type { Secret } from "./SecretModal";

// What an instance admin can do to an outgoing webhook from its row, the
// row the last failure belongs to, and which delivery logs are open: a
// test opens the log so its result is in view.
export function useOutgoingActions(onSecret: (secret: Secret) => void) {
  const queryClient = useQueryClient();
  const [failed, setFailed] = useState<{ id: string; text: string } | null>(
    null,
  );
  const [openLogs, setOpenLogs] = useState<Record<string, boolean>>({});
  const act = async (hook: OutgoingWebhook, fn: () => Promise<unknown>) => {
    setFailed(null);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: ["webhooks"] });
      await queryClient.invalidateQueries({
        queryKey: ["deliveries", hook.id],
      });
    } catch (err) {
      setFailed({ id: hook.id, text: errorText(err) });
    }
  };

  const test = (hook: OutgoingWebhook) =>
    act(hook, async () => {
      await integrationsClient.testWebhook({ id: hook.id });
      setOpenLogs((open) => ({ ...open, [hook.id]: true }));
    });
  const toggle = (hook: OutgoingWebhook) =>
    act(hook, () =>
      integrationsClient.updateOutgoing({
        id: hook.id,
        enabled: !hook.enabled,
      }),
    );
  const rotate = async (hook: OutgoingWebhook) => {
    const ok = await confirm({
      title: `Rotate the signing secret for “${hook.name}”?`,
      body: "Deliveries are signed with the new secret from now on; update the receiver.",
      action: "Rotate",
      danger: true,
    });
    if (!ok) return;
    act(hook, async () => {
      const res = await integrationsClient.rotateSecret({ id: hook.id });
      onSecret({ kind: "signing", name: hook.name, secret: res.secret });
    });
  };
  const remove = async (hook: OutgoingWebhook) => {
    const ok = await confirm({
      title: `Delete “${hook.name}”?`,
      body: "Nothing more is sent to it, and its delivery log goes too.",
      action: "Delete",
      danger: true,
    });
    if (ok) act(hook, () => integrationsClient.deleteWebhook({ id: hook.id }));
  };

  return { failed, openLogs, setOpenLogs, test, toggle, rotate, remove };
}
