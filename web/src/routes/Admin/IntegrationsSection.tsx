import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { instanceClient, integrationsClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import {
  useAllSpaces,
  useBots,
  useInstanceStatus,
  useWebhooks,
} from "../../api/queries";
import { EditBotModal } from "../../components/Integrations/EditBotModal";
import { NewBotModal } from "../../components/Integrations/NewBotModal";
import { NewBotTokenModal } from "../../components/Integrations/NewBotTokenModal";
import {
  type Secret,
  SecretModal,
} from "../../components/Integrations/SecretModal";
import { SettingRow } from "../../components/SettingRow";
import type { Bot, BotToken } from "../../gen/stoop/integrations/v1/bot_pb";
import { confirm } from "../../stores/dialogs";
import { BotsTable } from "./BotsTable";
import { SpaceWebhooksTable } from "./SpaceWebhooksTable";

// Server admin → Integrations: the three switches, every bot with its
// tokens, and every webhook on the server grouped by space — the one
// place that answers "what is my server talking to?".
export function IntegrationsSection() {
  const queryClient = useQueryClient();
  const { data: status } = useInstanceStatus();
  const { data: bots } = useBots(true);
  const { data: hooks } = useWebhooks("", true);
  const { data: spaces } = useAllSpaces(true);
  const [newBot, setNewBot] = useState(false);
  const [editing, setEditing] = useState<Bot | null>(null);
  const [tokenFor, setTokenFor] = useState<Bot | null>(null);
  const [secret, setSecret] = useState<Secret | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["bots"] });
    await queryClient.invalidateQueries({ queryKey: ["webhooks"] });
    await queryClient.invalidateQueries({ queryKey: ["instance-status"] });
  };
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(errorText(err));
    }
  };
  const flip = (
    key:
      | "webhooksIncoming"
      | "webhooksOutgoing"
      | "webhooksAllowPrivateTargets",
    value: boolean,
  ) => act(() => instanceClient.updateSettings({ [key]: value }));

  const [failed, setFailed] = useState<{ id: string; text: string } | null>(
    null,
  );
  const actOn = async (b: Bot, fn: () => Promise<unknown>) => {
    setFailed(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setFailed({ id: b.id, text: errorText(err) });
    }
  };
  const deactivate = async (b: Bot) => {
    const ok = await confirm({
      title: `Deactivate ${b.displayName || b.username}?`,
      body: "Every token and webhook it has stops working. Its messages stay.",
      action: "Deactivate",
      danger: true,
    });
    if (ok) actOn(b, () => integrationsClient.deactivateBot({ id: b.id }));
  };
  const revoke = async (b: Bot, t: BotToken) => {
    const ok = await confirm({
      title: `Revoke “${t.name}”?`,
      body: "Anything using it stops working straight away.",
      action: "Revoke",
      danger: true,
    });
    if (ok)
      actOn(b, () => integrationsClient.revokeBotToken({ tokenId: t.id }));
  };
  const nameOf = (id: string) => spaces?.find((s) => s.id === id)?.name;

  return (
    <>
      <section className="card integration-switches">
        {status && !status.webhooksAvailable && (
          <p className="hint">
            Webhooks are turned off in this server's environment
            (STOOP_WEBHOOKS=false); these switches have no effect until it's
            turned back on.
          </p>
        )}
        <SettingRow
          id="webhooks-incoming"
          title="Incoming webhooks"
          description="URLs that post into a channel. Off stops every one of them without deleting anything."
        >
          <input
            id="webhooks-incoming"
            type="checkbox"
            checked={status?.webhooksIncoming ?? true}
            disabled={!status}
            onChange={(e) => flip("webhooksIncoming", e.target.checked)}
          />
        </SettingRow>
        <SettingRow
          id="webhooks-outgoing"
          title="Outgoing webhooks"
          description="Signed events sent to URLs admins choose. Off stops every delivery."
        >
          <input
            id="webhooks-outgoing"
            type="checkbox"
            checked={status?.webhooksOutgoing ?? true}
            disabled={!status}
            onChange={(e) => flip("webhooksOutgoing", e.target.checked)}
          />
        </SettingRow>
        <SettingRow
          id="webhooks-private"
          title="Allow private targets"
          description="Let outgoing webhooks reach addresses on your LAN, loopback and Tailscale ranges. The cloud metadata address and link-local are never reachable."
        >
          <input
            id="webhooks-private"
            type="checkbox"
            checked={status?.webhooksAllowPrivateTargets ?? false}
            disabled={!status}
            onChange={(e) =>
              flip("webhooksAllowPrivateTargets", e.target.checked)
            }
          />
        </SettingRow>
        {error && <p className="error">{error}</p>}
      </section>

      <section className="card" data-section="bots">
        <div className="integrations-head">
          <h3>Bots</h3>
          <button
            type="button"
            className="chip"
            onClick={() => setNewBot(true)}
          >
            New bot
          </button>
        </div>
        <p className="hint">
          A bot is a member that signs in with nothing: it acts through the
          tokens and webhook URLs it's given. A bot with none left is
          deactivated.
        </p>
        <BotsTable
          bots={bots}
          hooks={hooks?.incoming}
          spaceName={nameOf}
          failed={failed}
          onNewToken={setTokenFor}
          onEdit={setEditing}
          onDeactivate={deactivate}
          onRevoke={revoke}
        />
      </section>

      <section className="card" data-section="all-webhooks">
        <h3>What this server talks to</h3>
        <p className="hint">
          Every webhook, by space. Change them from the space's own settings.
        </p>
        <SpaceWebhooksTable
          incoming={hooks?.incoming}
          outgoing={hooks?.outgoing}
        />
      </section>

      {newBot && <NewBotModal onClose={() => setNewBot(false)} />}
      {editing && (
        <EditBotModal bot={editing} onClose={() => setEditing(null)} />
      )}
      {tokenFor && (
        <NewBotTokenModal
          bot={tokenFor}
          onClose={() => setTokenFor(null)}
          onCreated={(s) => {
            setTokenFor(null);
            setSecret(s);
          }}
        />
      )}
      {secret && (
        <SecretModal secret={secret} onClose={() => setSecret(null)} />
      )}
    </>
  );
}
