import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  completeDesktopAuth,
  confirmDesktopLink,
  discardAttempt,
  pendingKind,
} from "../api/desktopAuth";
import { useInstanceStatus } from "../api/queries";
import { providerShortName } from "../components/LoginProviders";
import { safeRedirect } from "../router";
import { DesktopLinkConfirm } from "./DesktopLinkConfirm";

// Where the shell's stoop://auth hand-back lands. It loads here in the
// view that started the attempt, so the verifier is still in session
// storage; redeeming the code sets the session cookie in this view. A
// link stops to ask before it attaches anything.
export function DesktopAuthCompletePage() {
  const { code } = useSearch({ from: "/auth/desktop/complete" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: status } = useInstanceStatus();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    provider: string;
    email: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  // Read before the effect spends the attempt: it is what the wording
  // below is about.
  const [kind] = useState(pendingKind);
  const linking = kind === "link";
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
        if (result.kind === "confirmLink") {
          setPending(result);
          return;
        }
        if (result.kind === "reauthed") {
          // Same person, a new session: refetch what was read with the
          // old one rather than start from nothing.
          await queryClient.invalidateQueries();
          // href, not to: next carries its own query (?tab=security).
          await navigate({
            href: safeRedirect(result.next) ?? "/profile",
            replace: true,
          });
          return;
        }
        queryClient.clear();
        await navigate({
          to: safeRedirect(result.target) ?? "/",
          replace: true,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [code, linking, navigate, queryClient]);

  const confirm = async () => {
    if (!code) return;
    setBusy(true);
    setError(null);
    try {
      const provider = await confirmDesktopLink(code);
      // The session is unchanged, so nothing to clear: just the list
      // this added a row to.
      await queryClient.invalidateQueries({ queryKey: ["identities"] });
      await navigate({
        to: "/profile",
        search: { linked: provider },
        replace: true,
      });
    } catch (err) {
      setPending(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    discardAttempt();
    await navigate({ to: "/profile", replace: true });
  };

  const nameOf = (id: string) =>
    providerShortName(
      status?.loginProviders?.find((p) => p.id === id)?.displayName ?? id,
    );

  return (
    <div className="login-page">
      <div className="login-card">
        {pending ? (
          <DesktopLinkConfirm
            provider={nameOf(pending.provider)}
            email={pending.email}
            busy={busy}
            onConfirm={() => void confirm()}
            onCancel={() => void cancel()}
          />
        ) : (
          <>
            <h1>Stoop</h1>
            {error ? (
              <>
                <p className="error" role="alert">
                  {error}
                </p>
                {kind === "reauth" ? (
                  <Link className="link" to="/confirm">
                    Try again
                  </Link>
                ) : linking ? (
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
                {linking
                  ? "Checking that account…"
                  : kind === "reauth"
                    ? "Confirming…"
                    : "Finishing sign-in…"}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
