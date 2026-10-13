import { type FormEvent, useId, useState } from "react";
import { CHANNEL_NAME_HINT, MAX_CHANNEL_NAME } from "../api/channels";
import { chatClient } from "../api/clients";
import type { Channel } from "../gen/stoop/chat/v1/channel_pb";
import { ChannelKind } from "../gen/stoop/chat/v1/channel_pb";
import { useFieldErrors } from "../hooks/useFieldErrors";
import { Field } from "./Field";
import { Modal } from "./Modal";
import { Switch } from "./Switch";

// A new text channel: its name, and whether it is private. A private
// channel is made that way and stays that way.
export function NewChannelModal({
  spaceId,
  onClose,
  onCreated,
}: {
  spaceId: string;
  onClose: () => void;
  onCreated: (channel: Channel) => void;
}) {
  const formId = useId();
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const form = useFieldErrors(["name", "private"]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    form.begin();
    try {
      const res = await chatClient.createChannel({
        spaceId,
        name: name.trim(),
        kind: ChannelKind.TEXT,
        private: isPrivate,
      });
      if (res.channel) onCreated(res.channel);
      onClose();
    } catch (err) {
      form.fail(err);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New channel"
      onClose={onClose}
      small
      footer={
        <>
          <button type="button" className="chip" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            className="primary"
            disabled={busy || !name.trim()}
          >
            Create
          </button>
        </>
      }
    >
      <form
        id={formId}
        ref={form.formRef}
        className="modal-form new-channel-form"
        onSubmit={create}
      >
        <Field
          label="Channel name"
          counter={`${name.length} / ${MAX_CHANNEL_NAME}`}
          hint={CHANNEL_NAME_HINT}
          error={form.errors.name}
        >
          <input
            name="channel-name"
            value={name}
            maxLength={MAX_CHANNEL_NAME}
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
            // biome-ignore lint/a11y/noAutofocus: the first field of the dialog
            autoFocus
          />
        </Field>
        <label className="toggle-row">
          <Switch
            name="channel-private"
            checked={isPrivate}
            onChange={(event) => setIsPrivate(event.target.checked)}
          />
          <span>
            Private
            <span className="hint">
              Only people you add can see it. This can't be changed later.
            </span>
          </span>
        </label>
        {(form.errors.private || form.formError) && (
          <p className="error" role="alert">
            {form.errors.private ?? form.formError}
          </p>
        )}
      </form>
    </Modal>
  );
}
