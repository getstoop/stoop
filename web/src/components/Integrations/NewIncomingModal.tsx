import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { integrationsClient } from "../../api/clients";
import { absoluteHookUrl } from "../../api/integrations";
import { serverOrigin } from "../../api/origin";
import { useChannels } from "../../api/queries";
import { ChannelKind } from "../../gen/stoop/chat/v1/channel_pb";
import type { Space } from "../../gen/stoop/chat/v1/space_pb";
import { useFieldErrors } from "../../hooks/useFieldErrors";
import { Field } from "../Field";
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
  const form = useFieldErrors(["name", "channelId", "botUserId"]);
  const formId = useId();
  const chosenChannel = channelId || text[0]?.id || "";
  const ready = name.trim() !== "" && chosenChannel !== "";

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    form.begin();
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
      form.fail(err);
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
            type="submit"
            form={formId}
            className="primary"
            disabled={busy || !ready}
          >
            Create webhook
          </button>
        </>
      }
    >
      <form
        id={formId}
        ref={form.formRef}
        className="modal-body integration-form"
        onSubmit={create}
      >
        <p className="hint">
          A URL that posts into one channel. Paste it into anything with a
          webhook URL field, from an uptime monitor to a CI runner, or curl it.
        </p>
        <Field label="Name" error={form.errors.name}>
          <input
            name="hook-name"
            value={name}
            maxLength={50}
            placeholder="e.g. Uptime Kuma"
            onChange={(e) => setName(e.target.value)}
            // biome-ignore lint/a11y/noAutofocus: the first field of the dialog
            autoFocus
          />
        </Field>
        <Field label="Posts into" error={form.errors.channelId}>
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
        </Field>
        <Field
          label="Posts as"
          hint={
            <>
              Only bots already in this space are listed; add one from Server
              admin → Integrations first.
            </>
          }
          error={form.errors.botUserId}
        >
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
        </Field>
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
        {form.formError && (
          <p className="error" role="alert">
            {form.formError}
          </p>
        )}
      </form>
    </Modal>
  );
}
