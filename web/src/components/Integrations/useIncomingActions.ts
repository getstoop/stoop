import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { integrationsClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { absoluteHookUrl } from "../../api/integrations";
import { serverOrigin } from "../../api/origin";
import type { IncomingWebhook } from "../../gen/stoop/integrations/v1/webhook_pb";
import { confirm, prompt } from "../../stores/dialogs";
import type { Secret } from "./SecretModal";

// What an instance admin can do to an incoming webhook from its row, and
// the row the last failure belongs to.
export function useIncomingActions(onSecret: (secret: Secret) => void) {
  const queryClient = useQueryClient();
  const [failed, setFailed] = useState<{ id: string; text: string } | null>(
    null,
  );
  const refresh = async (hook: IncomingWebhook) => {
    await queryClient.invalidateQueries({ queryKey: ["webhooks"] });
    await queryClient.invalidateQueries({ queryKey: ["bots"] });
    await queryClient.invalidateQueries({
      queryKey: ["members", hook.spaceId],
    });
  };
  const act = async (hook: IncomingWebhook, fn: () => Promise<unknown>) => {
    setFailed(null);
    try {
      await fn();
      await refresh(hook);
    } catch (err) {
      setFailed({ id: hook.id, text: errorText(err) });
    }
  };

  const setNotify = (hook: IncomingWebhook, notifyEveryone: boolean) =>
    act(hook, () =>
      integrationsClient.updateIncoming({ id: hook.id, notifyEveryone }),
    );
  const toggle = (hook: IncomingWebhook) =>
    act(hook, () =>
      integrationsClient.updateIncoming({
        id: hook.id,
        enabled: !hook.enabled,
      }),
    );
  const rename = (hook: IncomingWebhook) =>
    prompt({
      title: "Rename this webhook",
      label: "Name",
      initial: hook.name,
      action: "Rename",
      submit: async (name) => {
        if (name === hook.name) return;
        await integrationsClient.updateIncoming({ id: hook.id, name });
        await refresh(hook);
      },
    });
  const rotate = async (hook: IncomingWebhook) => {
    const ok = await confirm({
      title: `Rotate the URL for “${hook.name}”?`,
      body: "The old URL stops working straight away. You'll need to paste the new one into the sender.",
      action: "Rotate",
      danger: true,
    });
    if (!ok) return;
    act(hook, async () => {
      const res = await integrationsClient.rotateSecret({ id: hook.id });
      onSecret({
        kind: "hook",
        name: hook.name,
        url: absoluteHookUrl(res.url, serverOrigin() || window.location.origin),
      });
    });
  };
  const remove = async (hook: IncomingWebhook) => {
    const ok = await confirm({
      title: `Delete “${hook.name}”?`,
      body: "Its URL stops working. The bot stays unless this was the last thing it had.",
      action: "Delete",
      danger: true,
    });
    if (ok) act(hook, () => integrationsClient.deleteWebhook({ id: hook.id }));
  };

  return { failed, setNotify, toggle, rename, rotate, remove };
}
