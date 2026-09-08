import { useSearch } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { authLinkForCode, errorLinkForCode } from "../api/desktopAuth";
import { loginErrorText } from "../api/loginErrors";
import { useInstanceStatus } from "../api/queries";

// The last page of the provider round trip, in the system browser. It
// fires the deep link that carries the person back to the app; the
// button is for when the browser asks first, or refuses.
export function DesktopAuthReturnPage() {
  const { code, error } = useSearch({ from: "/auth/desktop/return" });
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
            ? `${loginErrorText(error)} Stoop has the rest.`
            : `${server} is ready in the Stoop app.`}
        </p>
        <a className="provider-button" href={link}>
          Return to Stoop
        </a>
        <p className="muted">You can close this tab.</p>
      </div>
    </div>
  );
}
