import { type FormEvent, useState } from "react";
import { Modal } from "../Modal";
import type { ProviderRowState } from "./fields";
import { PRESETS, type Preset } from "./presets";

const ICONS = [
  { value: "none", label: "No icon" },
  { value: "key", label: "Key" },
  { value: "google", label: "Google" },
  { value: "microsoft", label: "Microsoft" },
];

const ID_RE = /^[a-z0-9_-]{2,32}$/;

// One provider's settings, in a dialog. A new provider starts from a
// preset (pure prefill); an existing one opens with its saved values and
// a write-only secret box.
export function ProviderModal({
  initial,
  takenIds,
  publicUrl,
  onSave,
  onClose,
}: {
  // null: adding a new provider.
  initial: ProviderRowState | null;
  // Ids already in use by *other* providers.
  takenIds: string[];
  publicUrl: string;
  onSave: (row: ProviderRowState) => Promise<void>;
  onClose: () => void;
}) {
  const [row, setRow] = useState<ProviderRowState>(
    initial ?? {
      key: "",
      id: "",
      displayName: "",
      icon: "key",
      issuer: "",
      clientId: "",
      secret: "",
      hasSecret: false,
      callbackUrl: "",
      fromEnv: false,
    },
  );
  const [presetHint, setPresetHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<ProviderRowState>) =>
    setRow((r) => ({ ...r, ...patch }));

  const applyPreset = (p: Preset) => {
    setPresetHint(p.hint ?? null);
    set({
      id: takenIds.includes(p.id) ? "" : p.id,
      displayName: p.displayName,
      icon: p.icon,
      issuer: p.issuer,
    });
  };

  const id = row.id.trim();
  const idTaken = takenIds.includes(id);
  const callback = publicUrl && id ? `${publicUrl}/auth/callback/${id}` : "";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (idTaken) {
      setError(`Provider id "${id}" is already used.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave({ ...row, id });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={
        initial
          ? `Edit ${initial.displayName || initial.id}`
          : "Add a login provider"
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" className="chip" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="provider-form"
            className="primary"
            disabled={busy}
          >
            {initial ? "Save" : "Add provider"}
          </button>
        </>
      }
    >
      <form
        id="provider-form"
        className="modal-form provider-form"
        onSubmit={submit}
      >
        {!initial && (
          <div className="provider-add">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="chip"
                data-preset={p.label}
                onClick={() => applyPreset(p)}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
        {presetHint && <p className="hint">{presetHint}</p>}
        <label className="field">
          Button text
          <input
            value={row.displayName}
            onChange={(e) => set({ displayName: e.target.value })}
            placeholder="Continue with Google"
            required
          />
        </label>
        <p className="hint">The whole button, exactly as people will see it.</p>
        <label className="field">
          Icon
          <select
            value={row.icon || "key"}
            onChange={(e) => set({ icon: e.target.value })}
          >
            {ICONS.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Provider id
          <input
            name="provider-id"
            value={row.id}
            onChange={(e) => set({ id: e.target.value })}
            pattern="[a-z0-9_-]{2,32}"
            title="2-32 of a-z, 0-9, -, _"
            required
          />
        </label>
        <p className="hint">
          Part of the callback URL. Changing it later disconnects accounts that
          signed in under the old id.
        </p>
        <label className="field">
          Issuer URL
          <input
            name="provider-issuer"
            value={row.issuer}
            onChange={(e) => set({ issuer: e.target.value })}
            placeholder="https://auth.example.com"
            required
          />
        </label>
        <label className="field">
          Client id
          <input
            name="provider-client-id"
            value={row.clientId}
            onChange={(e) => set({ clientId: e.target.value })}
            autoComplete="off"
            required
          />
        </label>
        <label className="field">
          Client secret
          <input
            type="password"
            name="provider-client-secret"
            value={row.secret}
            onChange={(e) => set({ secret: e.target.value })}
            placeholder={
              row.hasSecret
                ? "(saved — leave blank to keep)"
                : "From the provider's console"
            }
            autoComplete="off"
            required={!row.hasSecret}
          />
        </label>
        {callback ? (
          <div className="provider-callback">
            <span className="muted small">Callback URL for the console</span>
            <div className="link-box">
              <code>{callback}</code>
              <button
                type="button"
                className="chip"
                onClick={() => navigator.clipboard?.writeText(callback)}
              >
                Copy
              </button>
            </div>
          </div>
        ) : (
          ID_RE.test(id) && (
            <p className="hint">
              Set a public URL on the Hosting tab first — the provider console
              needs the callback URL it produces.
            </p>
          )
        )}
        {error && <p className="error">{error}</p>}
      </form>
    </Modal>
  );
}
