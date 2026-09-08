import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { completeDesktopSignIn } from "../api/desktopAuth";
import { safeRedirect } from "../router";

// Where the shell's stoop://auth hand-back lands. It loads here in the
// view that started the sign-in, so the verifier is still in session
// storage; redeeming the code sets the session cookie in this view.
export function DesktopAuthCompletePage() {
  const { code } = useSearch({ from: "/auth/desktop/complete" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // Guard against StrictMode's double effect: the code is single-use.
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        if (!code) throw new Error("That sign-in link was incomplete.");
        const redirect = await completeDesktopSignIn(code);
        queryClient.clear();
        await navigate({ to: safeRedirect(redirect) ?? "/", replace: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [code, navigate, queryClient]);

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Stoop</h1>
        {error ? (
          <>
            <p className="error">{error}</p>
            <Link className="link" to="/login">
              Back to sign-in
            </Link>
          </>
        ) : (
          <p className="muted">Finishing sign-in…</p>
        )}
      </div>
    </div>
  );
}
