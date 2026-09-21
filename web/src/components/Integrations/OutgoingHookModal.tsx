import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { integrationsClient } from "../../api/clients";
import { EVENT_TYPES } from "../../api/integrations";
import { useChannels } from "../../api/queries";
import { ChannelKind } from "../../gen/stoop/chat/v1/channel_pb";
import type { Space } from "../../gen/stoop/chat/v1/space_pb";
import type { OutgoingWebhook } from "../../gen/stoop/integrations/v1/webhook_pb";
import { useFieldErrors } from "../../hooks/useFieldErrors";
import { Field } from "../Field";
import { Modal } from "../Modal";
import type { Secret } from "./SecretModal";

// New or edited outgoing webhook: where events go, which ones, and from
// which channel. Creating shows the signing secret once.
export function OutgoingHookModal({
  space,
  existing,
  onClose,
  onCreated,
}: {
  space: Space;
  existing?: OutgoingWebhook;
  onClose: () => void;
  onCreated: (secret: Secret) => void;
}) {
  const queryClient = useQueryClient();
  const { data: channels } = useChannels(space.id);
  const text = (channels ?? []).filter((c) => c.kind !== ChannelKind.VOICE);
  const [name, setName] = useState(existing?.name ?? "");
  const [url, setUrl] = useState(existing?.url ?? "");
  const [channelId, setChannelId] = useState(existing?.channelId ?? "");
  const [types, setTypes] = useState<string[]>(
    existing?.eventTypes ?? ["message.created"],
  );
  const [busy, setBusy] = useState(false);
  const form = useFieldErrors(["name", "url", "channelId"]);
  const formId = useId();
  const ready = name.trim() !== "" && url.trim() !== "" && types.length > 0;

  const toggle = (key: string) =>
    setTypes(
      types.includes(key) ? types.filter((t) => t !== key) : [...types, key],
    );

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    form.begin();
    try {
      if (existing) {
        await integrationsClient.updateOutgoing({
          id: existing.id,
          name: name.trim(),
          url: url.trim(),
          channelId,
          eventTypes: types,
          setEventTypes: true,
        });
        await queryClient.invalidateQueries({ queryKey: ["webhooks"] });
        onClose();
        return;
      }
      const res = await integrationsClient.createOutgoing({
        spaceId: space.id,
        channelId,
        name: name.trim(),
        url: url.trim(),
        eventTypes: types,
      });
      await queryClient.invalidateQueries({ queryKey: ["webhooks"] });
      onCreated({
        kind: "signing",
        name: res.webhook?.name ?? name.trim(),
        secret: res.secret,
      });
    } catch (err) {
      form.fail(err);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={existing ? `Edit “${existing.name}”` : "New outgoing webhook"}
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
            {existing ? "Save" : "Create webhook"}
          </button>
        </>
      }
    >
      <form
        id={formId}
        ref={form.formRef}
        className="modal-body integration-form"
        onSubmit={save}
      >
        <p className="hint">
          Stoop POSTs a signed JSON event to this URL when something happens in
          the space. Deliveries retry four times over two and a half minutes.
        </p>
        <Field label="Name" error={form.errors.name}>
          <input
            name="outgoing-name"
            value={name}
            maxLength={50}
            placeholder="e.g. Home Assistant"
            onChange={(e) => setName(e.target.value)}
            // biome-ignore lint/a11y/noAutofocus: the first field of the dialog
            autoFocus
          />
        </Field>
        <Field label="URL" error={form.errors.url}>
          <input
            name="outgoing-url"
            value={url}
            placeholder="https://"
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <Field label="From" error={form.errors.channelId}>
          <select
            name="outgoing-channel"
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
          >
            <option value="">Every channel</option>
            {text.map((c) => (
              <option key={c.id} value={c.id}>
                # {c.name}
              </option>
            ))}
          </select>
        </Field>
        <fieldset className="event-types">
          <legend className="eyebrow">Send when</legend>
          {EVENT_TYPES.map((e) => (
            <label key={e.key} className="toggle-row">
              <input
                type="checkbox"
                name={`event-${e.key}`}
                checked={types.includes(e.key)}
                onChange={() => toggle(e.key)}
              />
              <span>{e.label}</span>
            </label>
          ))}
          {types.length === 0 && (
            <span className="hint">Choose at least one.</span>
          )}
        </fieldset>
        {form.formError && (
          <p className="error" role="alert">
            {form.formError}
          </p>
        )}
      </form>
    </Modal>
  );
}
