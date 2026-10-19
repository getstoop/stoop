import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { authClient } from "../../api/clients";
import { useInstanceStatus } from "../../api/queries";
import { useRecentSignIn } from "../../api/recentSignIn";
import { useFieldErrors } from "../../hooks/useFieldErrors";

// The last card under Security. It says plainly what stays and what
// goes before asking for a second click, because "delete" sets an
// expectation the messages do not meet: they stay, under the name. A
// recent sign-in confirms it's the person (ConfirmBanner).
export function DeleteAccountSection() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: status } = useInstanceStatus();
  const recent = useRecentSignIn();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const form = useFieldErrors([]);

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
    form.begin();
    try {
      await authClient.deleteAccount({});
      queryClient.clear();
      navigate({ to: "/login" });
    } catch (err) {
      form.fail(err);
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
          disabled={recent === false}
        >
          Delete my account…
        </button>
      ) : (
        <form ref={form.formRef} onSubmit={submit}>
          {form.formError && (
            <p className="error" role="alert">
              {form.formError}
            </p>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="chip"
              onClick={() => {
                setOpen(false);
                form.begin();
              }}
              disabled={busy}
            >
              Keep my account
            </button>
            <button
              type="submit"
              className="primary danger"
              disabled={busy || recent === false}
            >
              {busy ? "Deleting…" : "Delete my account"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
