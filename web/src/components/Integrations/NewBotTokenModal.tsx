import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { integrationsClient } from "../../api/clients";
import {
  BOT_GROUP_LABELS,
  BOT_TOKEN_OPTIONS,
  canCreate,
  permissionsFor,
} from "../../api/tokenOptions";
import type { Bot } from "../../gen/stoop/integrations/v1/bot_pb";
import { useFieldErrors } from "../../hooks/useFieldErrors";
import { Field } from "../Field";
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
  const form = useFieldErrors(["name"]);
  const formId = useId();
  const ready = canCreate({ name, keys });

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    form.begin();
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
      form.fail(err);
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
            type="submit"
            form={formId}
            className="primary"
            disabled={busy || !ready}
          >
            Create token
          </button>
        </>
      }
    >
      <form
        id={formId}
        ref={form.formRef}
        className="modal-body token-form"
        onSubmit={create}
      >
        <p className="hint">
          The token works in every space the bot is in, and only what you tick
          here. It doesn't expire; revoke it when it's done.
        </p>
        <Field label="Name" error={form.errors.name}>
          <input
            name="bot-token-name"
            value={name}
            maxLength={50}
            placeholder="e.g. mirror to Matrix"
            onChange={(e) => setName(e.target.value)}
            // biome-ignore lint/a11y/noAutofocus: the first field of the dialog
            autoFocus
          />
        </Field>
        <PermissionPicker
          options={BOT_TOKEN_OPTIONS}
          groupLabels={BOT_GROUP_LABELS}
          selected={keys}
          onChange={setKeys}
        />
        {form.formError && (
          <p className="error" role="alert">
            {form.formError}
          </p>
        )}
      </form>
    </Modal>
  );
}
