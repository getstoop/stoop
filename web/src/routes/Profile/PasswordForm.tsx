import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { authClient } from "../../api/clients";
import { usePersonalTokens } from "../../api/queries";
import { Field } from "../../components/Field";
import { useFieldErrors } from "../../hooks/useFieldErrors";

// Change password — or set the first one, for an account created via a
// login provider (then there is no current password to ask for). The
// new one is typed twice; a mismatch is caught before anything is sent.
export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "saved">("idle");
  const form = useFieldErrors(["currentPassword", "newPassword", "confirm"]);
  const { data: tokens } = usePersonalTokens();
  const tokenCount = tokens?.length ?? 0;
  // Pre-ticked: whoever had the session long enough to change the password
  // had it long enough to make a token.
  const [revokeTokens, setRevokeTokens] = useState(true);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    form.begin();
    if (next !== confirm) {
      form.set("confirm", "The two new passwords don't match.");
      return;
    }
    setState("busy");
    try {
      await authClient.changePassword({
        currentPassword: current,
        newPassword: next,
        revokePersonalTokens: tokenCount > 0 && revokeTokens,
      });
      setCurrent("");
      setNext("");
      setConfirm("");
      if (!hasPassword) {
        // "me" now reports hasPassword; the card becomes the change form.
        await queryClient.invalidateQueries({ queryKey: ["me"] });
      }
      if (tokenCount > 0 && revokeTokens) {
        await queryClient.invalidateQueries({ queryKey: ["personal-tokens"] });
      }
      setState("saved");
      setTimeout(() => setState("idle"), 2500);
    } catch (err) {
      form.fail(err);
      setState("idle");
    }
  };

  return (
    <form className="card" ref={form.formRef} onSubmit={submit}>
      <h3>{hasPassword ? "Change password" : "Set a password"}</h3>
      <p className="hint">
        {hasPassword
          ? "Changing it signs you out everywhere except this browser."
          : "So you can sign in with your username even if the login provider goes away."}
      </p>
      {hasPassword && (
        <Field label="Current password" error={form.errors.currentPassword}>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
      )}
      <Field label="New password" error={form.errors.newPassword}>
        <input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
        />
      </Field>
      <Field label="Confirm new password" error={form.errors.confirm}>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
          aria-invalid={confirm !== "" && confirm !== next ? true : undefined}
        />
      </Field>
      {tokenCount > 0 && (
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={revokeTokens}
            onChange={(e) => setRevokeTokens(e.target.checked)}
          />
          <span>
            Also revoke my{" "}
            {tokenCount === 1
              ? "personal token"
              : `${tokenCount} personal tokens`}
          </span>
        </label>
      )}
      {form.formError && (
        <p className="error" role="alert">
          {form.formError}
        </p>
      )}
      <div className="setting-actions">
        <button type="submit" className="primary" disabled={state === "busy"}>
          {state === "saved"
            ? hasPassword
              ? "Password changed"
              : "Password set"
            : hasPassword
              ? "Change password"
              : "Set password"}
        </button>
      </div>
    </form>
  );
}
