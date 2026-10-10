import { type FormEvent, useState } from "react";
import { authClient } from "../../api/clients";
import { confirmPasswordError } from "../../api/passwordReset";
import { Field } from "../../components/Field";
import { useFieldErrors } from "../../hooks/useFieldErrors";

// The new password, typed twice; a mismatch is caught before anything is
// sent. Sessions are signed out either way; tokens only when ticked.
export function NewPasswordForm({
  token,
  instanceName,
  username,
  onDone,
}: {
  token: string;
  instanceName: string;
  username: string;
  onDone: () => void;
}) {
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [revokeTokens, setRevokeTokens] = useState(false);
  const [busy, setBusy] = useState(false);
  const form = useFieldErrors(["newPassword", "confirm"]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    form.begin();
    const mismatch = confirmPasswordError(newPassword, confirm);
    if (mismatch) {
      form.set("confirm", mismatch);
      return;
    }
    setBusy(true);
    try {
      await authClient.completePasswordReset({
        token,
        newPassword,
        revokePersonalTokens: revokeTokens,
      });
      onDone();
    } catch (err) {
      form.fail(err);
      setBusy(false);
    }
  };

  return (
    <form
      className="login-card"
      ref={form.formRef}
      onSubmit={submit}
      noValidate
    >
      <h1>{instanceName}</h1>
      <p className="login-subtitle">Choose a new password for @{username}.</p>
      <Field
        label="New password"
        hint="At least 8 characters."
        error={form.errors.newPassword}
      >
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
        />
      </Field>
      <Field label="Confirm new password" error={form.errors.confirm}>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
        />
      </Field>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={revokeTokens}
          onChange={(e) => setRevokeTokens(e.target.checked)}
        />
        <span>
          Also revoke my access tokens
          <br />
          <span className="muted">
            Scripts and bots using them stop working.
          </span>
        </span>
      </label>
      <p className="hint">
        Every device signed in to this account will be signed out.
      </p>
      {form.formError && (
        <p className="error" role="alert">
          {form.formError}
        </p>
      )}
      <button type="submit" className="primary" disabled={busy}>
        {busy ? "Saving…" : "Set new password"}
      </button>
    </form>
  );
}
