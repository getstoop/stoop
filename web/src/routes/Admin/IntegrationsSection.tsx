import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { instanceClient, integrationsClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { eventLabel, hookCanText } from "../../api/integrations";
import {
  useAllSpaces,
  useBots,
  useInstanceStatus,
  useWebhooks,
} from "../../api/queries";
import {
  BOT_TOKEN_OPTIONS,
  describePermissions,
  lastUsedText,
  whereText,
} from "../../api/tokenOptions";
import { BotRow } from "../../components/Integrations/BotRow";
import { EditBotModal } from "../../components/Integrations/EditBotModal";
import { NewBotModal } from "../../components/Integrations/NewBotModal";
import { NewBotTokenModal } from "../../components/Integrations/NewBotTokenModal";
import {
  type Secret,
  SecretModal,
} from "../../components/Integrations/SecretModal";
import { ListHead } from "../../components/ListHead";
import { SettingRow } from "../../components/SettingRow";
import type { Bot, BotToken } from "../../gen/stoop/integrations/v1/bot_pb";
import { confirm } from "../../stores/dialogs";

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

  const deactivate = async (b: Bot) => {
    const ok = await confirm({
      title: `Deactivate ${b.displayName || b.username}?`,
      body: "Every token and webhook it has stops working. Its messages stay.",
      action: "Deactivate",
      danger: true,
    });
    if (ok) act(() => integrationsClient.deactivateBot({ id: b.id }));
  };
  const revoke = async (t: BotToken) => {
    const ok = await confirm({
      title: `Revoke “${t.name}”?`,
      body: "Anything using it stops working straight away.",
      action: "Revoke",
      danger: true,
    });
    if (ok) act(() => integrationsClient.revokeBotToken({ tokenId: t.id }));
  };
  const nameOf = (id: string) => spaces?.find((s) => s.id === id)?.name;
  const hooksOf = (botId: string) =>
    hooks?.incoming.filter((h) => h.botUserId === botId) ?? [];

  const bySpace = new Map<
    string,
    { name: string; incoming: number; outgoing: number }
  >();
  for (const h of hooks?.incoming ?? []) {
    const e = bySpace.get(h.spaceId) ?? {
      name: h.spaceName,
      incoming: 0,
      outgoing: 0,
    };
    e.incoming++;
    bySpace.set(h.spaceId, e);
  }
  for (const h of hooks?.outgoing ?? []) {
    const e = bySpace.get(h.spaceId) ?? {
      name: h.spaceName,
      incoming: 0,
      outgoing: 0,
    };
    e.outgoing++;
    bySpace.set(h.spaceId, e);
  }

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
        {bots && bots.length === 0 && (
          <p className="muted small">No bots yet.</p>
        )}
        {bots && bots.length > 0 && (
          <ul className="user-list table bots">
            <ListHead columns={["Bot", "Standing", "", ""]} />
            {bots.map((b) => {
              const own = hooksOf(b.id);
              const where =
                b.spaceIds.length === 0
                  ? "in no spaces yet"
                  : `in ${b.spaceIds.map((id) => nameOf(id) ?? "a space").join(", ")}`;
              const standing = b.deactivatedAt
                ? "deactivated"
                : `${own.length} webhook${own.length === 1 ? "" : "s"}, ${b.tokens.length} token${b.tokens.length === 1 ? "" : "s"} · ${where}`;
              return (
                <BotRow
                  key={b.id}
                  username={b.username}
                  displayName={b.displayName}
                  avatarFileId={b.avatarFileId}
                  standing={standing}
                  inactive={!!b.deactivatedAt}
                  actions={
                    !b.deactivatedAt && (
                      <>
                        <button
                          type="button"
                          className="chip"
                          onClick={() => setTokenFor(b)}
                        >
                          New token
                        </button>
                        <button
                          type="button"
                          className="chip"
                          onClick={() => setEditing(b)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="chip danger"
                          onClick={() => deactivate(b)}
                        >
                          Deactivate
                        </button>
                      </>
                    )
                  }
                >
                  {(b.tokens.length > 0 || own.length > 0) && (
                    <>
                      {b.tokens.map((t) => (
                        <div
                          key={t.id}
                          className="bot-credential-row"
                          data-token={t.name}
                        >
                          <strong>{t.name}</strong>
                          <span>
                            token ·{" "}
                            {describePermissions(
                              t.permissions,
                              BOT_TOKEN_OPTIONS,
                            ).join(", ")}
                            {t.limited && (
                              <> · limited to {whereText(t, nameOf)}</>
                            )}
                            {" · "}…{t.hint}
                          </span>
                          <span className="muted">
                            {lastUsedText(
                              t.lastUsedAt && timestampDate(t.lastUsedAt),
                            )}
                          </span>
                          <div className="user-row-actions">
                            <button
                              type="button"
                              className="chip danger"
                              onClick={() => revoke(t)}
                            >
                              Revoke
                            </button>
                          </div>
                        </div>
                      ))}
                      {own.map((h) => (
                        <div
                          key={h.id}
                          className="bot-credential-row"
                          data-hook={h.name}
                        >
                          <strong>{h.name}</strong>
                          <span>
                            webhook into {h.spaceName} · {hookCanText(h)} · …
                            {h.hint}
                            {!h.enabled && (
                              <span className="hook-disabled">
                                {" "}
                                · off: {h.disabledReason}
                              </span>
                            )}
                          </span>
                          <span className="muted">
                            {lastUsedText(
                              h.lastUsedAt && timestampDate(h.lastUsedAt),
                            )}
                          </span>
                          <span />
                        </div>
                      ))}
                    </>
                  )}
                </BotRow>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card" data-section="all-webhooks">
        <h3>What this server talks to</h3>
        <p className="hint">
          Every webhook, by space. Change them from the space's own settings.
        </p>
        {hooks && bySpace.size === 0 && (
          <p className="muted small">No webhooks anywhere.</p>
        )}
        {bySpace.size > 0 && (
          <ul className="user-list table">
            <ListHead columns={["Space", "Webhooks", ""]} />
            {[...bySpace.entries()].map(([id, e]) => (
              <li key={id} className="user-row" data-space={e.name}>
                <div className="user-row-main">
                  <strong>{e.name || id}</strong>
                </div>
                <span className="user-cell">
                  {e.incoming} in, {e.outgoing} out
                  {hooks?.outgoing
                    .filter((h) => h.spaceId === id)
                    .map((h) => (
                      <span key={h.id} className="small">
                        <br />
                        {h.name} → {h.url} (
                        {h.eventTypes.map(eventLabel).join(", ")})
                      </span>
                    ))}
                </span>
                <span />
              </li>
            ))}
          </ul>
        )}
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
