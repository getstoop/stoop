import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { authClient } from "../../api/clients";
import { Field } from "../../components/Field";
import { LoginProviders } from "../../components/LoginProviders";
import { useFieldErrors } from "../../hooks/useFieldErrors";

// Step 1: the first account, which operates the server.
export function AccountStep({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const form = useFieldErrors(["username", "password"]);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    form.begin();
    try {
      await authClient.register({ username, password });
      await authClient.login({ username, password });
      queryClient.clear();
      onDone();
    } catch (err) {
      form.fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="login-card bare" ref={form.formRef} onSubmit={submit}>
      <p>
        <strong>Welcome to your new Stoop.</strong>
      </p>
      <p className="hint">
        This first account is the server admin: it manages server settings and
        has admin powers in every space. Pick a username you'll keep.
      </p>
      <LoginProviders redirect="/setup" />
      <Field label="Username" error={form.errors.username}>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
        />
      </Field>
      <Field label="Password" error={form.errors.password}>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
        />
      </Field>
      {form.formError && (
        <p className="error" role="alert">
          {form.formError}
        </p>
      )}
      <button type="submit" className="primary" disabled={busy}>
        Create admin account
      </button>
    </form>
  );
}
