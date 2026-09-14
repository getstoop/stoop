import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { integrationsClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { Modal } from "../Modal";

// A bot account on its own: a member with no password, authenticated only
// through the tokens and hooks it's given later.
export function NewBotModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = username.trim() !== "" && displayName.trim() !== "";

  const create = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await integrationsClient.createBot({
        username: username.trim(),
        displayName: displayName.trim(),
      });
      await queryClient.invalidateQueries({ queryKey: ["bots"] });
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New bot"
      onClose={onClose}
      small
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
            Create bot
          </button>
        </>
      }
    >
      <div className="modal-body integration-form">
        <label className="field">
          Username
          <input
            name="bot-username"
            value={username}
            maxLength={32}
            placeholder="e.g. homeassistant"
            onChange={(e) => setUsername(e.target.value)}
            // biome-ignore lint/a11y/noAutofocus: the first field of the dialog
            autoFocus
          />
        </label>
        <label className="field">
          Display name
          <input
            name="bot-display-name"
            value={displayName}
            maxLength={50}
            placeholder="e.g. Home Assistant"
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>
        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  );
}
