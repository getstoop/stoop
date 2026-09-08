import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { completeDesktopAuth, pendingIsLink } from "../api/desktopAuth";
import { safeRedirect } from "../router";

// Where the shell's stoop://auth hand-back lands. It loads here in the
// view that started the attempt, so the verifier is still in session
// storage; redeeming the code sets the session cookie in this view, or
// attaches the identity to the session it already has.
export function DesktopAuthCompletePage() {
  const { code } = useSearch({ from: "/auth/desktop/complete" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  // Read before the effect spends the attempt: it is what the wording
  // below is about.
  const [linking] = useState(pendingIsLink);
  const started = useRef(false);

  useEffect(() => {
    // Guard against StrictMode's double effect: the code is single-use.
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        if (!code) {
          throw new Error(
            linking
              ? "That link was incomplete."
              : "That sign-in link was incomplete.",
          );
        }
        const result = await completeDesktopAuth(code);
        if (result.kind === "linked") {
          // The session is unchanged, so nothing to clear: just the
          // list this added a row to.
          await queryClient.invalidateQueries({ queryKey: ["identities"] });
          await navigate({
            to: "/profile",
            search: { linked: result.provider },
            replace: true,
          });
          return;
        }
        queryClient.clear();
        await navigate({
          to: safeRedirect(result.redirect) ?? "/",
          replace: true,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [code, linking, navigate, queryClient]);

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Stoop</h1>
        {error ? (
          <>
            <p className="error">{error}</p>
            {linking ? (
              <Link className="link" to="/profile">
                Back to your profile
              </Link>
            ) : (
              <Link className="link" to="/login">
                Back to sign-in
              </Link>
            )}
          </>
        ) : (
          <p className="muted">
            {linking ? "Connecting your account…" : "Finishing sign-in…"}
          </p>
        )}
      </div>
    </div>
  );
}
