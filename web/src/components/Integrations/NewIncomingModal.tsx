import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { integrationsClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { absoluteHookUrl } from "../../api/integrations";
import { serverOrigin } from "../../api/origin";
import { useChannels } from "../../api/queries";
import { ChannelKind } from "../../gen/stoop/chat/v1/channel_pb";
import type { Space } from "../../gen/stoop/chat/v1/space_pb";
import { Modal } from "../Modal";
import type { Secret } from "./SecretModal";

// New incoming webhook: a name, the channel it posts into, the bot it
// posts as (a new one by default) and whether it may notify everyone.
export function NewIncomingModal({
  space,
  bots,
  onClose,
  onCreated,
}: {
  space: Space;
  // Bots the admin may attach to: id and a label.
  bots: { id: string; label: string }[];
  onClose: () => void;
  onCreated: (secret: Secret) => void;
}) {
  const queryClient = useQueryClient();
  const { data: channels } = useChannels(space.id);
  const text = (channels ?? []).filter((c) => c.kind !== ChannelKind.VOICE);
  const [name, setName] = useState("");
  const [channelId, setChannelId] = useState("");
  const [botUserId, setBotUserId] = useState("");
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosenChannel = channelId || text[0]?.id || "";
  const ready = name.trim() !== "" && chosenChannel !== "";

  const create = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await integrationsClient.createIncoming({
        channelId: chosenChannel,
        name: name.trim(),
        botUserId,
        notifyEveryone: notify,
      });
      await queryClient.invalidateQueries({ queryKey: ["webhooks"] });
      await queryClient.invalidateQueries({ queryKey: ["bots"] });
      await queryClient.invalidateQueries({ queryKey: ["members", space.id] });
      onCreated({
        kind: "hook",
        name: res.webhook?.name ?? name.trim(),
        url: absoluteHookUrl(res.url, serverOrigin() || window.location.origin),
      });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New incoming webhook"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="chip" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={create}
            disabled={busy || !ready}
          >
            Create webhook
          </button>
        </>
      }
    >
      <div className="modal-body integration-form">
        <p className="hint">
          A URL that posts into one channel. Paste it into anything with a
          webhook URL field, from an uptime monitor to a CI runner, or curl it.
        </p>
        <label className="field">
          Name
          <input
            name="hook-name"
            value={name}
            maxLength={50}
            placeholder="e.g. Uptime Kuma"
            onChange={(e) => setName(e.target.value)}
            // biome-ignore lint/a11y/noAutofocus: the first field of the dialog
            autoFocus
          />
        </label>
        <label className="field">
          Posts into
          <select
            name="hook-channel"
            value={chosenChannel}
            onChange={(e) => setChannelId(e.target.value)}
          >
            {text.map((c) => (
              <option key={c.id} value={c.id}>
                # {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Posts as
          <select
            name="hook-bot"
            value={botUserId}
            onChange={(e) => setBotUserId(e.target.value)}
          >
            <option value="">A new bot named after this webhook</option>
            {bots.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
          <span className="hint">
            Only bots already in this space are listed; add one from Server
            admin → Integrations first.
          </span>
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            name="hook-notify"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
          />
          <span>
            May notify everyone
            <span className="hint">
              Lets @everyone and @here in its posts ping the space. This makes
              the bot a space admin, since only admins may; the webhook itself
              can still only post.
            </span>
          </span>
        </label>
        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  );
}
