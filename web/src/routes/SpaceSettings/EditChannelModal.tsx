import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { MAX_CHANNEL_TOPIC } from "../../api/channels";
import { chatClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { Modal } from "../../components/Modal";
import type { Channel } from "../../gen/stoop/chat/v1/channel_pb";

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
  const [error, setError] = useState<string | null>(null);

  const nextName = name.trim();
  const nextTopic = topic.trim();
  const changed = nextName !== channel.name || nextTopic !== channel.topic;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!changed || !nextName) return;
    setBusy(true);
    setError(null);
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
      setError(errorText(err));
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
      <form id={formId} className="modal-body" onSubmit={save}>
        <label className="field">
          Name
          <input
            name="channel-name"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            // biome-ignore lint/a11y/noAutofocus: the first field of the dialog
            autoFocus
          />
        </label>
        <label className="field">
          Topic
          <input
            name="channel-topic"
            value={topic}
            maxLength={MAX_CHANNEL_TOPIC}
            placeholder="One line, shown in the channel header."
            onChange={(e) => setTopic(e.target.value)}
          />
        </label>
        {error && <p className="error">{error}</p>}
      </form>
    </Modal>
  );
}
