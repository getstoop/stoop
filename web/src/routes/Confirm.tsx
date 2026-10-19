import { useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate, useSearch } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { authClient } from "../api/clients";
import { isSignedOut } from "../api/errors";
import { CONFIRM_FAILED } from "../api/loginErrors";
import { useIdentities, useInstanceStatus, useMe } from "../api/queries";
import { safeRedirect } from "../api/safeRedirect";
import { Field } from "../components/Field";
import { LoginProviders } from "../components/LoginProviders";
import { useFieldErrors } from "../hooks/useFieldErrors";

// "Confirm it's you": signing in again without signing out, before a
// change that needs a recent sign-in (docs/architecture/identity.md →
// Confirm it's you). It offers only this account's ways in, the password
// if it has one and the providers linked to it, and says nothing about
// why those and not others. Success replaces the session; the server sets
// the new cookie, and the person goes back to where they were.
export function ConfirmPage() {
  const { next, error: errorCode } = useSearch({ from: "/confirm" });
  const target = safeRedirect(next) ?? "/profile";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: me, error: meError } = useMe();
  const { data: status } = useInstanceStatus();
  const { data: identities } = useIdentities();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useFieldErrors(["password"]);
  // A provider round trip that didn't confirm lands back here with
  // ?error=; whatever the code, it says the same thing.
  const error = form.formError ?? (errorCode ? CONFIRM_FAILED : null);

  if (isSignedOut(meError)) {
    return <Navigate to="/login" search={{ redirect: target }} replace />;
  }
  if (!me || !status || !identities) {
    return <div className="login-page muted">Loading…</div>;
  }
  const linked = identities.map((i) => i.provider);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    form.begin();
    try {
      await authClient.reauthenticate({ password });
      // Same person, a new session: refetch what was read with the old
      // one rather than start from nothing.
      await queryClient.invalidateQueries();
      // href, not to: the target carries its own query (?tab=security).
      await navigate({ href: target, replace: true });
    } catch (err) {
      form.fail(err);
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" ref={form.formRef} onSubmit={submit}>
        <p className="muted small">{location.host}</p>
        <h1>Confirm it's you</h1>
        <p className="login-subtitle">
          Log in again to change your account settings.
        </p>
        {!me.hasPassword && error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <LoginProviders
          redirect={target}
          reauth
          only={linked}
          divider={me.hasPassword}
        />
        {me.hasPassword && (
          <>
            {/* The account is the session's, so there is nothing to type
                here; a password manager still wants a username beside the
                password to know which one to fill. */}
            <input
              type="text"
              autoComplete="username"
              value={me.username}
              readOnly
              hidden
            />
            <Field label="Password" error={form.errors.password}>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Confirming…" : "Confirm"}
            </button>
          </>
        )}
        <button
          type="button"
          className="link"
          onClick={() => void navigate({ href: target })}
        >
          Cancel and go back
        </button>
      </form>
    </div>
  );
}
