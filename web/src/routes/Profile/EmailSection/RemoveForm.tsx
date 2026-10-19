import { type FormEvent, useState } from "react";
import { authClient } from "../../../api/clients";
import { useRecentSignIn } from "../../../api/recentSignIn";
import { useFieldErrors } from "../../../hooks/useFieldErrors";

// Removing the address: a recent sign-in confirms it's the person
// (ConfirmBanner), so there is nothing to type.
export function RemoveForm({
  onRemoved,
  onClose,
}: {
  onRemoved: () => void;
  onClose: () => void;
}) {
  const recent = useRecentSignIn();
  const [busy, setBusy] = useState(false);
  const form = useFieldErrors([]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    form.begin();
    setBusy(true);
    try {
      await authClient.removeEmail({});
      onRemoved();
    } catch (err) {
      form.fail(err);
      setBusy(false);
    }
  };

  return (
    <form ref={form.formRef} onSubmit={submit} noValidate>
      {form.formError && (
        <p className="error" role="alert">
          {form.formError}
        </p>
      )}
      <div className="setting-actions">
        <button
          type="submit"
          className="primary danger"
          disabled={busy || recent === false}
        >
          {busy ? "Removing…" : "Remove address"}
        </button>
        <button
          type="button"
          className="chip"
          onClick={onClose}
          disabled={busy}
        >
          Keep it
        </button>
      </div>
    </form>
  );
}
