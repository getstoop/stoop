import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { integrationsClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import {
  BOT_GROUP_LABELS,
  botOptions,
  canCreate,
  permissionsFor,
} from "../../api/tokenOptions";
import type { Bot } from "../../gen/stoop/integrations/v1/bot_pb";
import { Modal } from "../Modal";
import { PermissionPicker } from "../PermissionPicker";
import type { Secret } from "./SecretModal";

// A bearer token for a bot: any grantable permission, working wherever
// the bot is a member. Unlike a personal token it never expires; revoke
// it instead.
export function NewBotTokenModal({
  bot,
  onClose,
  onCreated,
}: {
  bot: Bot;
  onClose: () => void;
  onCreated: (secret: Secret) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [keys, setKeys] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = canCreate({ name, keys });

  const create = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await integrationsClient.createBotToken({
        botUserId: bot.id,
        name: name.trim(),
        permissions: permissionsFor(keys),
      });
      await queryClient.invalidateQueries({ queryKey: ["bots"] });
      onCreated({
        kind: "token",
        name: res.token?.name ?? name.trim(),
        secret: res.secret,
      });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`New token for ${bot.displayName || bot.username}`}
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
            Create token
          </button>
        </>
      }
    >
      <div className="modal-body token-form">
        <p className="hint">
          The token works in every space the bot is in, and only what you tick
          here. It doesn't expire; revoke it when it's done.
        </p>
        <label className="field">
          Name
          <input
            name="bot-token-name"
            value={name}
            maxLength={50}
            placeholder="e.g. mirror to Matrix"
            onChange={(e) => setName(e.target.value)}
            // biome-ignore lint/a11y/noAutofocus: the first field of the dialog
            autoFocus
          />
        </label>
        <PermissionPicker
          options={botOptions(bot)}
          groupLabels={BOT_GROUP_LABELS}
          selected={keys}
          onChange={setKeys}
        />
        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  );
}
