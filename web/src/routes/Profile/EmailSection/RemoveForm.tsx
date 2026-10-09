import { type FormEvent, useState } from "react";
import { authClient } from "../../../api/clients";
import { Field } from "../../../components/Field";
import { useFieldErrors } from "../../../hooks/useFieldErrors";

// Removing the address asks for the password, when the account has one.
export function RemoveForm({
  hasPassword,
  onRemoved,
  onClose,
}: {
  hasPassword: boolean;
  onRemoved: () => void;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // Without a password there is no field for a refusal to land on.
  const form = useFieldErrors(hasPassword ? ["password"] : []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    form.begin();
    setBusy(true);
    try {
      await authClient.removeEmail({ password });
      onRemoved();
    } catch (err) {
      form.fail(err);
      setBusy(false);
    }
  };

  return (
    <form ref={form.formRef} onSubmit={submit} noValidate>
      {hasPassword && (
        <Field label="Current password" error={form.errors.password}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </Field>
      )}
      {form.formError && (
        <p className="error" role="alert">
          {form.formError}
        </p>
      )}
      <div className="setting-actions">
        <button type="submit" className="primary danger" disabled={busy}>
          {busy ? "Removing…" : "Remove address"}
        </button>
        <button type="button" className="chip" onClick={onClose}>
          Keep it
        </button>
      </div>
    </form>
  );
}
