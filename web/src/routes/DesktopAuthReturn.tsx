import { useSearch } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { authLinkForCode, errorLinkForCode } from "../api/desktopAuth";
import { loginErrorText } from "../api/loginErrors";
import { useInstanceStatus } from "../api/queries";
import { startURL } from "../components/LoginProviders";

// The last page of the provider round trip, in the system browser. It
// fires the deep link that carries the person back to the app; the
// button is for when the browser asks first, or refuses.
export function DesktopAuthReturnPage() {
  const { code, error, provider } = useSearch({ from: "/auth/desktop/return" });
  const { data: status } = useInstanceStatus();
  const fired = useRef(false);
  const link = code ? authLinkForCode(code) : errorLinkForCode(error ?? "");

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    location.href = link;
  }, [link]);

  const server = status?.instanceName || "Stoop";
  return (
    <div className="login-page">
      <div className="login-card">
        <h1>{error ? "Sign-in didn't finish" : "You're signed in"}</h1>
        <p className="login-subtitle">
          {error
            ? loginErrorText(error)
            : `${server} is ready in the Stoop app.`}
        </p>
        <a className="provider-button" href={link}>
          Return to Stoop
        </a>
        {/* The code is bound to the app's window and cannot be redeemed
            here, so carrying on in this browser means signing in to it. */}
        <a className="link" href={continueHere(error, provider)}>
          {error ? "Continue in this browser" : "Or use this browser instead"}
        </a>
      </div>
    </div>
  );
}

function continueHere(error?: string, provider?: string): string {
  if (error) return `/login?error=${encodeURIComponent(error)}`;
  return provider ? startURL(provider) : "/login";
}
