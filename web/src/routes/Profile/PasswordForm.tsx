import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { authClient } from "../../api/clients";
import { errorText } from "../../api/errors";

// Change password — or set the first one, for an account created via a
// login provider (then there is no current password to ask for). The
// new one is typed twice; a mismatch is caught before anything is sent.
export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError("The two new passwords don't match.");
      return;
    }
    setState("busy");
    try {
      await authClient.changePassword({
        currentPassword: current,
        newPassword: next,
      });
      setCurrent("");
      setNext("");
      setConfirm("");
      if (!hasPassword) {
        // "me" now reports hasPassword; the card becomes the change form.
        await queryClient.invalidateQueries({ queryKey: ["me"] });
      }
      setState("saved");
      setTimeout(() => setState("idle"), 2500);
    } catch (err) {
      setError(errorText(err));
      setState("idle");
    }
  };

  return (
    <form className="card" onSubmit={submit}>
      <h3>{hasPassword ? "Change password" : "Set a password"}</h3>
      <p className="hint">
        {hasPassword
          ? "Changing it signs you out everywhere except this browser."
          : "So you can sign in with your username even if the login provider goes away."}
      </p>
      {hasPassword && (
        <label>
          Current password
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
      )}
      <label>
        New password
        <input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
        />
      </label>
      <label>
        Confirm new password
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
          aria-invalid={confirm !== "" && confirm !== next ? true : undefined}
        />
      </label>
      {error && <p className="error">{error}</p>}
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
