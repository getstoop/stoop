import { type FormEvent, useState } from "react";
import { authClient } from "../../../api/clients";
import { Field } from "../../../components/Field";
import type { MyEmail } from "../../../gen/stoop/auth/v1/auth_pb";
import { useFieldErrors } from "../../../hooks/useFieldErrors";

// Add or change: the new address, and the password when the account has
// one. noValidate so a refusal lands under its field, not in a browser
// bubble.
export function AddressForm({
  hasPassword,
  onSent,
  onClose,
}: {
  hasPassword: boolean;
  onSent: (email: MyEmail | undefined) => void;
  onClose: () => void;
}) {
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useFieldErrors(
    hasPassword ? ["address", "password"] : ["address"],
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    form.begin();
    setBusy(true);
    try {
      const reply = await authClient.requestEmailChange({ address, password });
      onSent(reply.email);
    } catch (err) {
      form.fail(err);
      setBusy(false);
    }
  };

  return (
    <form ref={form.formRef} onSubmit={submit} noValidate>
      <Field label="Email address" error={form.errors.address}>
        <input
          type="text"
          inputMode="email"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          autoComplete="email"
        />
      </Field>
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
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Sending…" : "Send link"}
        </button>
        <button type="button" className="chip" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}
