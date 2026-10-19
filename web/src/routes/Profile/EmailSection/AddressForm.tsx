import { type FormEvent, useState } from "react";
import { authClient } from "../../../api/clients";
import { useRecentSignIn } from "../../../api/recentSignIn";
import { Field } from "../../../components/Field";
import type { MyEmail } from "../../../gen/stoop/auth/v1/auth_pb";
import { useFieldErrors } from "../../../hooks/useFieldErrors";

// Add or change: the new address. A recent sign-in confirms it's the
// person (ConfirmBanner). noValidate so a refusal lands under its field,
// not in a browser bubble.
export function AddressForm({
  onSent,
  onClose,
}: {
  onSent: (email: MyEmail | undefined) => void;
  onClose: () => void;
}) {
  const recent = useRecentSignIn();
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useFieldErrors(["address"]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    form.begin();
    setBusy(true);
    try {
      const reply = await authClient.requestEmailChange({ address });
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
      {form.formError && (
        <p className="error" role="alert">
          {form.formError}
        </p>
      )}
      <div className="setting-actions">
        <button
          type="submit"
          className="primary"
          disabled={busy || recent === false}
        >
          {busy ? "Sending…" : "Send link"}
        </button>
        <button
          type="button"
          className="chip"
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
