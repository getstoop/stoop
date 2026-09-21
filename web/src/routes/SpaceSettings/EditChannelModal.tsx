import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { CHANNEL_NAME_HINT, MAX_CHANNEL_TOPIC } from "../../api/channels";
import { chatClient } from "../../api/clients";
import { Field } from "../../components/Field";
import { Modal } from "../../components/Modal";
import type { Channel } from "../../gen/stoop/chat/v1/channel_pb";
import { useFieldErrors } from "../../hooks/useFieldErrors";

// A channel's name and topic, from its row in Space settings → Channels.
// Only what changed is sent; an emptied topic is cleared.
export function EditChannelModal({
  channel,
  onClose,
}: {
  channel: Channel;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const formId = useId();
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic);
  const [busy, setBusy] = useState(false);
  const form = useFieldErrors(["name", "topic"]);

  const nextName = name.trim();
  const nextTopic = topic.trim();
  const changed = nextName !== channel.name || nextTopic !== channel.topic;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!changed || !nextName) return;
    setBusy(true);
    form.begin();
    try {
      await chatClient.updateChannel({
        channelId: channel.id,
        name: nextName !== channel.name ? nextName : undefined,
        topic: nextTopic !== channel.topic ? nextTopic : undefined,
      });
      await queryClient.invalidateQueries({
        queryKey: ["channels", channel.spaceId],
      });
      onClose();
    } catch (err) {
      form.fail(err);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Edit #${channel.name}`}
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
            disabled={busy || !changed || !nextName}
          >
            Save
          </button>
        </>
      }
    >
      <form
        id={formId}
        ref={form.formRef}
        className="modal-form channel-edit-form"
        onSubmit={save}
      >
        <Field label="Name" hint={CHANNEL_NAME_HINT} error={form.errors.name}>
          <input
            name="channel-name"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            // biome-ignore lint/a11y/noAutofocus: the first field of the dialog
            autoFocus
          />
        </Field>
        <Field label="Topic" error={form.errors.topic}>
          <input
            name="channel-topic"
            value={topic}
            maxLength={MAX_CHANNEL_TOPIC}
            placeholder="One line, shown in the channel header."
            onChange={(e) => setTopic(e.target.value)}
          />
        </Field>
        {form.formError && (
          <p className="error" role="alert">
            {form.formError}
          </p>
        )}
      </form>
    </Modal>
  );
}
