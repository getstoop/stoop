import { useEffect, useRef } from "react";
import { openLinkForPath, underAutomation } from "../api/desktopLinks";

// What an invite link lands on in a browser: the app, or here. It does
// nothing with the invite — the code is a string on its way somewhere
// else — so it never blocks a redemption, and a dead code still fails
// where it always did, on the page that handles it.
// docs/architecture/desktop.md → Deep links.
export function InviteHandoff({
  path,
  onContinue,
}: {
  path: string;
  onContinue: () => void;
}) {
  const link = openLinkForPath(path);
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current || underAutomation()) return;
    fired.current = true;
    location.href = link;
  }, [link]);

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Stoop</h1>
        <p className="login-subtitle">
          You've been invited to a space on someone's stoop.
        </p>
        <div className="open-in-app">
          <p className="muted">Opening Stoop…</p>
          <a className="provider-button" href={link}>
            Open in the Stoop app
          </a>
          <button type="button" className="link" onClick={onContinue}>
            Continue in this browser
          </button>
        </div>
      </div>
    </div>
  );
}
