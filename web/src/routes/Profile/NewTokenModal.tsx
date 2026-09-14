import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { authClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { useMyPermissions, useSpaces } from "../../api/queries";
import {
  canCreate,
  DEFAULT_EXPIRY_DAYS,
  EXPIRY_CHOICES,
  heldOptions,
  permissionsFor,
  withDependencies,
  withoutOrphans,
} from "../../api/tokenOptions";
import { Modal } from "../../components/Modal";
import { PermissionPicker } from "../../components/PermissionPicker";

// Security → Personal tokens → New token. It starts as narrow as it can:
// nothing ticked. It works everywhere its holder does; the only dial is
// what it may do.
export function NewTokenModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (name: string, secret: string) => void;
}) {
  const queryClient = useQueryClient();
  const { data: spaces } = useSpaces();
  const { data: mine } = useMyPermissions();
  const [name, setName] = useState("");
  const [days, setDays] = useState(DEFAULT_EXPIRY_DAYS);
  const [keys, setKeys] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = heldOptions([
    ...(mine ?? []),
    ...(spaces ?? []).flatMap((s) => s.myPermissions),
  ]);
  const ready = canCreate({ name, keys });

  const create = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authClient.createPersonalToken({
        name: name.trim(),
        permissions: permissionsFor(keys),
        expiresInDays: days,
      });
      await queryClient.invalidateQueries({ queryKey: ["personal-tokens"] });
      onCreated(res.token?.name ?? name.trim(), res.secret);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New personal token"
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
        <div className="token-form-row">
          <label className="field">
            Name
            <input
              name="token-name"
              value={name}
              maxLength={50}
              placeholder="e.g. backup script"
              onChange={(e) => setName(e.target.value)}
              // biome-ignore lint/a11y/noAutofocus: the first field of the dialog
              autoFocus
            />
          </label>
          <label className="field">
            Expires
            <select
              name="token-expiry"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              {EXPIRY_CHOICES.map((c) => (
                <option key={c.days} value={c.days}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {days === 0 && (
          <p className="token-warning">
            A token that never expires keeps working until you revoke it, even
            if you forget it exists.
          </p>
        )}

        <PermissionPicker
          options={options}
          selected={keys}
          onChange={(next) => setKeys(withDependencies(withoutOrphans(next)))}
        />
        <p className="hint">
          It works in every space you're in, including ones you join later, with
          only what you tick here.
        </p>

        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  );
}
