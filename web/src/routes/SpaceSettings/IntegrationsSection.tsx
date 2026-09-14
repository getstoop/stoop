import { useState } from "react";
import { isBot } from "../../api/identity";
import { canNotifyEveryone } from "../../api/integrations";
import {
  useChannels,
  useInstanceStatus,
  useMembers,
  useMyPermissions,
  useWebhooks,
} from "../../api/queries";
import { BotRow } from "../../components/Integrations/BotRow";
import { IncomingRow } from "../../components/Integrations/IncomingRow";
import { NewIncomingModal } from "../../components/Integrations/NewIncomingModal";
import { OutgoingHookModal } from "../../components/Integrations/OutgoingHookModal";
import { OutgoingRow } from "../../components/Integrations/OutgoingRow";
import {
  type Secret,
  SecretModal,
} from "../../components/Integrations/SecretModal";
import { ListHead } from "../../components/ListHead";
import { Permission } from "../../gen/stoop/access/v1/access_pb";
import type { Space } from "../../gen/stoop/chat/v1/space_pb";
import { SpaceRole } from "../../gen/stoop/chat/v1/space_pb";
import type { OutgoingWebhook } from "../../gen/stoop/integrations/v1/webhook_pb";

// Space settings → Integrations: what posts into this space, grouped by
// the bot it posts as, and where the space's events go. Every member
// reads it; instance admins change it (docs/proposals/webhooks.md).
export function IntegrationsSection({ space }: { space: Space }) {
  const { data: hooks } = useWebhooks(space.id);
  const { data: members } = useMembers(space.id);
  const { data: channels } = useChannels(space.id);
  const { data: status } = useInstanceStatus();
  const { data: mine } = useMyPermissions();
  const manage = !!mine?.includes(Permission.INSTANCE_INTEGRATIONS_MANAGE);
  const [newIncoming, setNewIncoming] = useState(false);
  const [outgoing, setOutgoing] = useState<{
    existing?: OutgoingWebhook;
  } | null>(null);
  const [secret, setSecret] = useState<Secret | null>(null);

  const channelName = (id: string) =>
    channels?.find((c) => c.id === id)?.name ?? "a channel";
  const bots = new Map<
    string,
    typeof members extends (infer M)[] | undefined ? M : never
  >();
  for (const m of members ?? []) bots.set(m.userId, m);
  const byBot = new Map<string, NonNullable<typeof hooks>["incoming"]>();
  for (const h of hooks?.incoming ?? []) {
    byBot.set(h.botUserId, [...(byBot.get(h.botUserId) ?? []), h]);
  }
  const available = status?.webhooksAvailable ?? true;

  return (
    <>
      <section className="card" data-section="incoming">
        <div className="integrations-head">
          <h3>Post into this space</h3>
          {manage && available && status?.webhooksIncoming && (
            <button
              type="button"
              className="chip"
              onClick={() => setNewIncoming(true)}
            >
              New incoming webhook
            </button>
          )}
        </div>
        <p className="hint">
          Tools with a webhook URL field, and anything that can curl, post here
          as a bot. Each URL posts into one channel and can do nothing else.
          {!manage &&
            " Only server admins can change these; a space admin can remove a bot from the space."}
        </p>
        {!available && (
          <p className="hint">Webhooks are turned off on this server.</p>
        )}
        {available && status && !status.webhooksIncoming && (
          <p className="hint">
            Incoming webhooks are turned off on this server.
          </p>
        )}
        {hooks && byBot.size === 0 && (
          <p className="muted small">Nothing posts into this space yet.</p>
        )}
        {byBot.size > 0 && (
          <ul className="user-list table bots">
            <ListHead columns={["Bot", "Standing", "", ""]} />
            {[...byBot.entries()].map(([botId, list]) => {
              const m = bots.get(botId);
              const notifies = list.some(canNotifyEveryone);
              const standing =
                m?.role === SpaceRole.ADMIN
                  ? notifies
                    ? "admin, so it can notify everyone"
                    : "admin"
                  : m
                    ? "member"
                    : "not in this space";
              return (
                <BotRow
                  key={botId}
                  username={m?.username ?? "bot"}
                  displayName={m?.displayName ?? list[0].name}
                  avatarFileId={m?.avatarFileId}
                  standing={standing}
                  inactive={!m}
                >
                  {list.map((h) => (
                    <IncomingRow
                      key={h.id}
                      hook={h}
                      channelName={channelName(h.channelId)}
                      manage={manage}
                      onSecret={setSecret}
                    />
                  ))}
                </BotRow>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card" data-section="outgoing">
        <div className="integrations-head">
          <h3>Send events out</h3>
          {manage && available && status?.webhooksOutgoing && (
            <button
              type="button"
              className="chip"
              onClick={() => setOutgoing({})}
            >
              New outgoing webhook
            </button>
          )}
        </div>
        <p className="hint">
          Stoop POSTs a signed event to a URL you choose when something happens
          here. Direct messages never leave.
        </p>
        {available && status && !status.webhooksOutgoing && (
          <p className="hint">
            Outgoing webhooks are turned off on this server.
          </p>
        )}
        {hooks && hooks.outgoing.length === 0 && (
          <p className="muted small">Nothing is sent out of this space.</p>
        )}
        {hooks && hooks.outgoing.length > 0 && (
          <ul className="user-list table outgoing">
            <ListHead columns={["Webhook", "Sends", "State", ""]} />
            {hooks.outgoing.map((h) => (
              <OutgoingRow
                key={h.id}
                hook={h}
                channelName={h.channelId ? channelName(h.channelId) : undefined}
                manage={manage}
                onEdit={(existing) => setOutgoing({ existing })}
                onSecret={setSecret}
              />
            ))}
          </ul>
        )}
      </section>

      {newIncoming && (
        <NewIncomingModal
          space={space}
          bots={(members ?? [])
            .filter((m) => isBot(m.kind))
            .map((m) => ({ id: m.userId, label: m.displayName || m.username }))}
          onClose={() => setNewIncoming(false)}
          onCreated={(s) => {
            setNewIncoming(false);
            setSecret(s);
          }}
        />
      )}
      {outgoing && (
        <OutgoingHookModal
          space={space}
          existing={outgoing.existing}
          onClose={() => setOutgoing(null)}
          onCreated={(s) => {
            setOutgoing(null);
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
