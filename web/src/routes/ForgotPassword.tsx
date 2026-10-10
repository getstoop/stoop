import { Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { authClient } from "../api/clients";
import { errorText, fieldError } from "../api/errors";
import { emailAddressError, resetOffered } from "../api/passwordReset";
import { useInstanceStatus } from "../api/queries";
import { Field } from "../components/Field";
import { PasswordSignIn } from "../gen/stoop/instance/v1/instance_pb";
import { useFieldErrors } from "../hooks/useFieldErrors";

// Asks for a reset link by email. The reply is the same whether or not an
// account has the address, so the page says the same either way.
export function ForgotPasswordPage() {
  const { data: status, isLoading, error: statusError } = useInstanceStatus();
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A refusal about no field (a rate limit, email off): the form's line,
  // where a one-field form would otherwise put it under the field.
  const [refusal, setRefusal] = useState<string | null>(null);
  const form = useFieldErrors(["email"]);
  const instanceName = status?.instanceName || "Stoop";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    form.begin();
    setRefusal(null);
    const shapeError = emailAddressError(email);
    if (shapeError) {
      form.set("email", shapeError);
      return;
    }
    setBusy(true);
    try {
      await authClient.requestPasswordReset({ email: email.trim() });
      setSentTo(email.trim());
    } catch (err) {
      if (fieldError(err)) form.fail(err);
      else setRefusal(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return <div className="login-page muted">Loading…</div>;
  }

  if (sentTo !== null) {
    return (
      <div className="login-page">
        <div className="login-card">
          <h1>{instanceName}</h1>
          <p className="login-lead">Check your email.</p>
          <p className="login-subtitle">
            If an account on {instanceName} has the address {sentTo}, we've sent
            it a link. It works for an hour.
          </p>
          <p className="hint">
            No email? Check spam, or ask an admin of {instanceName} to reset
            your password.
          </p>
          <Link className="link" to="/login">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  if (statusError) {
    return (
      <div className="login-page">
        <div className="login-card">
          <h1>{instanceName}</h1>
          <p className="error" role="alert">
            {errorText(statusError)}
          </p>
          <Link className="link" to="/login">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  if (
    !resetOffered(
      status?.passwordResetAvailable ?? false,
      status?.passwordSignIn ?? PasswordSignIn.EVERYONE,
    )
  ) {
    return (
      <div className="login-page">
        <div className="login-card">
          <h1>{instanceName}</h1>
          <p className="login-subtitle">
            This server can't send password reset links. Ask an admin of{" "}
            {instanceName} to reset your password.
          </p>
          <Link className="link" to="/login">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <form
        className="login-card"
        ref={form.formRef}
        onSubmit={submit}
        noValidate
      >
        <h1>{instanceName}</h1>
        <p className="login-subtitle">
          Forgot your password? Enter your account's email address and we'll
          send you a link to set a new one.
        </p>
        <Field label="Email address" error={form.errors.email}>
          <input
            type="text"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </Field>
        {(refusal ?? form.formError) && (
          <p className="error" role="alert">
            {refusal ?? form.formError}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Sending…" : "Send reset link"}
        </button>
        <Link className="link" to="/login">
          Back to sign in
        </Link>
      </form>
    </div>
  );
}
