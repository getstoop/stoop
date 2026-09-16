import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { authClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { useInstanceStatus } from "../../api/queries";

// The last card under Security. It says plainly what stays and what
// goes before asking for the password, because "delete" sets an
// expectation the messages do not meet: they stay, under the name.
export function DeleteAccountSection({
  hasPassword,
}: {
  hasPassword: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: status } = useInstanceStatus();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status && !status.selfDeletion) {
    return (
      <section className="card delete-account">
        <h3>Delete your account</h3>
        <p className="hint">
          This server doesn't let people delete their own accounts. Ask an
          admin.
        </p>
      </section>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authClient.deleteAccount({ password });
      queryClient.clear();
      navigate({ to: "/login" });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <section className="card delete-account">
      <h3>Delete your account</h3>
      <p className="hint">
        Your messages stay where they were, under your username with a
        "(deleted)" mark. Your profile, avatar, bio and pronouns go, every
        device is signed out, and your tokens stop working. Spaces you own pass
        to their longest-serving admin. The username stays yours: nobody can
        register it.{" "}
        <span className="warning">
          This can't be undone, not even by an admin.
        </span>
      </p>
      {!open ? (
        <button
          type="button"
          className="primary danger"
          onClick={() => setOpen(true)}
        >
          Delete my account…
        </button>
      ) : (
        <form onSubmit={submit}>
          {hasPassword ? (
            <label>
              Your password, to confirm
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
          ) : (
            <p className="hint">
              Your account has no password, so this only works within ten
              minutes of signing in.
            </p>
          )}
          {error && <p className="error">{error}</p>}
          <div className="form-actions">
            <button
              type="button"
              className="chip"
              onClick={() => {
                setOpen(false);
                setPassword("");
                setError(null);
              }}
              disabled={busy}
            >
              Keep my account
            </button>
            <button type="submit" className="primary danger" disabled={busy}>
              {busy ? "Deleting…" : "Delete my account"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
