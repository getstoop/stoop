import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { authClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { isSpentLink } from "../../api/passwordReset";
import { useInstanceStatus } from "../../api/queries";
import { NewPasswordForm } from "./NewPasswordForm";

// Where a reset email's link lands. Opening it only reads whose account
// it is for; the link is used up by "Set new password".
export function ResetPasswordPage() {
  const search = useSearch({ from: "/reset-password" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: status } = useInstanceStatus();
  const [token] = useState(search.token);
  const [done, setDone] = useState(false);
  const [spentLater, setSpentLater] = useState(false);
  const instanceName = status?.instanceName || "Stoop";

  // The token stays in memory only, out of the address bar and history.
  useEffect(() => {
    if (search.token) {
      void navigate({ to: "/reset-password", search: {}, replace: true });
    }
  }, [search.token, navigate]);

  const reset = useQuery({
    queryKey: ["password-reset", token],
    queryFn: async () => authClient.getPasswordReset({ token: token ?? "" }),
    enabled: !!token,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  // Every session was signed out, this browser's included: drop what the
  // cache holds about it, keeping only what this page still shows.
  const finish = () => {
    queryClient.removeQueries({
      predicate: (query) =>
        query.queryKey[0] !== "instance-status" &&
        query.queryKey[0] !== "password-reset",
    });
    setDone(true);
  };

  const spent = spentLater || (reset.isError && isSpentLink(reset.error));

  return (
    <div className="login-page">
      {done ? (
        <div className="login-card">
          <h1>{instanceName}</h1>
          <p className="login-lead">
            The password for @{reset.data?.username} was changed.
          </p>
          <p className="login-subtitle">
            Every device was signed out. Sign in with your new password.
          </p>
          <button
            type="button"
            className="primary"
            onClick={() => void navigate({ to: "/login" })}
          >
            Sign in
          </button>
        </div>
      ) : !token ? (
        <div className="login-card">
          <h1>{instanceName}</h1>
          <p className="login-subtitle">Open the link from your email again.</p>
          <Link className="link" to="/forgot-password">
            Send a new link
          </Link>
        </div>
      ) : spent ? (
        <div className="login-card">
          <h1>{instanceName}</h1>
          <p className="error">This link has expired or was already used.</p>
          <Link className="link" to="/forgot-password">
            Send a new link
          </Link>
        </div>
      ) : reset.isError ? (
        <div className="login-card">
          <h1>{instanceName}</h1>
          <p className="error" role="alert">
            {errorText(reset.error)}
          </p>
        </div>
      ) : reset.data ? (
        <NewPasswordForm
          token={token ?? ""}
          instanceName={instanceName}
          username={reset.data.username}
          onDone={finish}
          onSpent={() => setSpentLater(true)}
        />
      ) : (
        <div className="muted">Loading…</div>
      )}
    </div>
  );
}
