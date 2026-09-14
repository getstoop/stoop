import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { integrationsClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { useSpaces } from "../../api/queries";
import {
  canCreate,
  permissionsFor,
  TOKEN_OPTIONS,
} from "../../api/tokenOptions";
import type { Bot } from "../../gen/stoop/integrations/v1/bot_pb";
import { Modal } from "../Modal";
import { PermissionPicker } from "../PermissionPicker";
import { SpacePicker } from "../SpacePicker";
import type { Secret } from "./SecretModal";

// A bearer token for a bot: any grantable permission, optionally limited
// to spaces. Unlike a personal token it never expires; revoke it instead.
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
  const { data: spaces } = useSpaces();
  const [name, setName] = useState("");
  const [keys, setKeys] = useState<string[]>([]);
  const [limited, setLimited] = useState(true);
  const [spaceIds, setSpaceIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = canCreate({ name, keys, limited, spaceIds });

  const create = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await integrationsClient.createBotToken({
        botUserId: bot.id,
        name: name.trim(),
        permissions: permissionsFor(keys, limited),
        limited,
        spaceIds: limited ? spaceIds : [],
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
          The bot can only do what it could as a member, and the token only what
          you tick here. It doesn't expire; revoke it when it's done.
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
          options={TOKEN_OPTIONS}
          selected={keys}
          limited={limited}
          onChange={setKeys}
        />
        <fieldset className="token-scope">
          <legend>Where it works</legend>
          <label className="toggle-row">
            <input
              type="radio"
              name="bot-token-scope"
              checked={!limited}
              onChange={() => setLimited(false)}
            />
            <span>
              Everywhere the bot is
              <span className="hint">including spaces it's added to later</span>
            </span>
          </label>
          <label className="toggle-row">
            <input
              type="radio"
              name="bot-token-scope"
              checked={limited}
              onChange={() => setLimited(true)}
            />
            <span>Only in these spaces</span>
          </label>
          {limited && (
            <SpacePicker
              spaces={spaces ?? []}
              selected={spaceIds}
              onChange={setSpaceIds}
            />
          )}
        </fieldset>
        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  );
}
