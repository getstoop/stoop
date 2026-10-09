import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { authClient } from "../api/clients";
import { errorText } from "../api/errors";
import { useInstanceStatus, useMe } from "../api/queries";

const EXPIRED = "This link has expired or was already used.";

// Where an email's confirmation link lands, signed in or not. Nothing is
// sent until Confirm, so a mail scanner opening the link confirms nothing.
export function ConfirmEmailPage() {
  const search = useSearch({ from: "/confirm-email" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: status } = useInstanceStatus();
  const { data: me } = useMe();
  const [token] = useState(search.token);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : EXPIRED);

  // The token stays in memory only, out of the address bar and history.
  useEffect(() => {
    if (search.token) {
      void navigate({ to: "/confirm-email", search: {}, replace: true });
    }
  }, [search.token, navigate]);

  const confirm = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await authClient.confirmEmail({ token });
      setDone(true);
      if (me) await queryClient.invalidateQueries({ queryKey: ["me"] });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>{status?.instanceName || "Stoop"}</h1>
        {done ? (
          <>
            <p className="login-subtitle">Email address confirmed.</p>
            {me ? (
              <Link className="link" to="/">
                Open Stoop
              </Link>
            ) : (
              <Link className="link" to="/login">
                Sign in
              </Link>
            )}
          </>
        ) : (
          <>
            <p className="login-subtitle">
              Confirm this email address for your account.
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {token && (
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void confirm()}
              >
                {busy ? "Confirming…" : "Confirm"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
