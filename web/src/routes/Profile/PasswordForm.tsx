import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { authClient } from "../../api/clients";
import { usePersonalTokens } from "../../api/queries";
import { useRecentSignIn } from "../../api/recentSignIn";
import { Field } from "../../components/Field";
import { useFieldErrors } from "../../hooks/useFieldErrors";

// Change password — or set the first one, for an account created via a
// login provider. No current password: a recent sign-in confirms it's the
// person (ConfirmBanner). The new one is typed twice; a mismatch is
// caught before anything is sent.
export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const queryClient = useQueryClient();
  const recent = useRecentSignIn();
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "saved">("idle");
  const form = useFieldErrors(["newPassword", "confirm"]);
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
        newPassword: next,
        revokePersonalTokens: tokenCount > 0 && revokeTokens,
      });
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
    <form className="card needs-confirm" ref={form.formRef} onSubmit={submit}>
      <h3>{hasPassword ? "Change password" : "Set a password"}</h3>
      <p className="hint">
        {hasPassword
          ? "Changing it signs you out everywhere except this browser."
          : "So you can sign in with your username even if the login provider goes away."}
      </p>
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
        <button
          type="submit"
          className="primary"
          disabled={state === "busy" || recent === false}
        >
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
