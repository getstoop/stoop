import { useEffect, useRef, useState } from "react";
import { canOpenInApp, openLinkForPath } from "../api/desktopLinks";

// Hands an invite to the desktop app. The attempt fires as soon as this
// renders, so someone who has the app lands in it; the button is for
// when the browser asked first, or refused. Nothing is remembered: every
// invite leads with the app, and the way past it is one click.
// docs/architecture/desktop.md → Deep links.
export function OpenInApp({
  path,
  quiet,
  onContinue,
}: {
  path: string;
  // Beside a flow already running, rather than standing in front of one.
  quiet?: boolean;
  onContinue?: () => void;
}) {
  const link = canOpenInApp(path) ? openLinkForPath(path) : "";
  const [gone, setGone] = useState(false);
  // The anchor below fires its own link; only the arrival needs this.
  const fired = useRef(false);

  useEffect(() => {
    if (!link || gone || fired.current) return;
    fired.current = true;
    location.href = link;
  }, [link, gone]);

  if (!link || gone) return null;

  const stay = () => {
    setGone(true);
    onContinue?.();
  };

  if (quiet) {
    return (
      <p className="open-in-app quiet">
        <span className="muted">Opening Stoop… Not opening?</span>{" "}
        <button type="button" className="link" onClick={stay}>
          Continue in this browser
        </button>
      </p>
    );
  }
  return (
    <div className="open-in-app">
      <p className="muted">Opening Stoop…</p>
      <a className="provider-button" href={link}>
        Open in the Stoop app
      </a>
      <button type="button" className="link" onClick={stay}>
        Continue in this browser
      </button>
    </div>
  );
}
