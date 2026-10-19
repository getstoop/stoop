import { useSearch } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import {
  type AttemptKind,
  authLinkForCode,
  errorLinkForCode,
} from "../api/desktopAuth";
import {
  CONFIRM_FAILED,
  linkErrorText,
  loginErrorText,
} from "../api/loginErrors";
import { useInstanceStatus } from "../api/queries";
import { startURL } from "../components/LoginProviders";

// The last page of the provider round trip, in the system browser. It
// fires the deep link that carries the person back to the app; the
// button is for when the browser asks first, or refuses.
export function DesktopAuthReturnPage() {
  const { code, error, provider, link, reauth } = useSearch({
    from: "/auth/desktop/return",
  });
  const { data: status } = useInstanceStatus();
  const fired = useRef(false);
  const kind: AttemptKind =
    link === "1" ? "link" : reauth === "1" ? "reauth" : "signIn";
  const deepLink = code
    ? authLinkForCode(code)
    : errorLinkForCode(error ?? "", kind);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    location.href = deepLink;
  }, [deepLink]);

  const server = status?.instanceName || "Stoop";
  return (
    <div className="login-page">
      <div className="login-card">
        <h1>{heading(kind, error)}</h1>
        <p className="login-subtitle">{subtitle(kind, error, server)}</p>
        <a className="provider-button" href={deepLink}>
          Return to Stoop
        </a>
        {kind !== "signIn" ? (
          // A link or reauth belongs to the app's session, which this
          // browser does not have: there is nothing to carry on with here.
          <p className="muted small">You can close this tab.</p>
        ) : (
          /* The code is bound to the app's window and cannot be redeemed
             here, so carrying on in this browser means signing in to it. */
          <a className="link" href={continueHere(error, provider)}>
            {error ? "Continue in this browser" : "Or use this browser instead"}
          </a>
        )}
      </div>
    </div>
  );
}

function heading(kind: AttemptKind, error?: string): string {
  if (kind === "link") {
    return error ? "Connecting didn't finish" : "Almost there";
  }
  if (kind === "reauth") return error ? "Not confirmed" : "Almost there";
  return error ? "Sign-in didn't finish" : "You're signed in";
}

function subtitle(
  kind: AttemptKind,
  error: string | undefined,
  server: string,
) {
  if (error) {
    if (kind === "reauth") return CONFIRM_FAILED;
    return kind === "link" ? linkErrorText(error) : loginErrorText(error);
  }
  // A link or reauth finishes in the app, not here: this page has only
  // handed the code over.
  if (kind === "link") {
    return "Return to the Stoop app to finish connecting your account.";
  }
  if (kind === "reauth") return "Return to the Stoop app to carry on.";
  return `${server} is ready in the Stoop app.`;
}

function continueHere(error?: string, provider?: string): string {
  if (error) return `/login?error=${encodeURIComponent(error)}`;
  return provider ? startURL(provider) : "/login";
}
