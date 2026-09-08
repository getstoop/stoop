import { useSearch } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { authLinkForCode, errorLinkForCode } from "../api/desktopAuth";
import { linkErrorText, loginErrorText } from "../api/loginErrors";
import { useInstanceStatus } from "../api/queries";
import { startURL } from "../components/LoginProviders";

// The last page of the provider round trip, in the system browser. It
// fires the deep link that carries the person back to the app; the
// button is for when the browser asks first, or refuses.
export function DesktopAuthReturnPage() {
  const { code, error, provider, link } = useSearch({
    from: "/auth/desktop/return",
  });
  const { data: status } = useInstanceStatus();
  const fired = useRef(false);
  const linking = link === "1";
  const deepLink = code
    ? authLinkForCode(code)
    : errorLinkForCode(error ?? "", linking);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    location.href = deepLink;
  }, [deepLink]);

  const server = status?.instanceName || "Stoop";
  return (
    <div className="login-page">
      <div className="login-card">
        <h1>{heading(linking, error)}</h1>
        <p className="login-subtitle">{subtitle(linking, error, server)}</p>
        <a className="provider-button" href={deepLink}>
          Return to Stoop
        </a>
        {linking ? (
          // A link belongs to the app's session, which this browser does
          // not have: there is nothing to carry on with here.
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

function heading(linking: boolean, error?: string): string {
  if (linking) return error ? "Connecting didn't finish" : "Almost there";
  return error ? "Sign-in didn't finish" : "You're signed in";
}

function subtitle(linking: boolean, error: string | undefined, server: string) {
  if (error) return linking ? linkErrorText(error) : loginErrorText(error);
  // A link is attached in the app, not here: this page has only handed
  // the code over.
  return linking
    ? "Return to the Stoop app to finish connecting your account."
    : `${server} is ready in the Stoop app.`;
}

function continueHere(error?: string, provider?: string): string {
  if (error) return `/login?error=${encodeURIComponent(error)}`;
  return provider ? startURL(provider) : "/login";
}
