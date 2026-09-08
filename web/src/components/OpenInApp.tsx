import { useEffect, useRef, useState } from "react";
import {
  openLinkForPath,
  prefersBrowser,
  rememberPrefersBrowser,
} from "../api/desktopLinks";
import { isDesktop } from "../api/platform";

// Hands an invite to the desktop app. The attempt fires as soon as this
// renders, so someone who has the app lands in it; the button is for when
// the browser asked first, or refused. Taking the way back is remembered
// for this server: a person with no app meets their browser's "open
// with?" dialog once, and is left a line to change their mind by.
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
  const link = isDesktop() ? "" : openLinkForPath(path);
  const [state, setState] = useState<"opening" | "offer">(() =>
    prefersBrowser() ? "offer" : "opening",
  );
  // The anchors below fire their own link; only the arrival needs this.
  const fired = useRef(false);

  useEffect(() => {
    if (!link || state !== "opening" || fired.current) return;
    fired.current = true;
    location.href = link;
  }, [link, state]);

  if (!link) return null;

  const open = () => {
    fired.current = true;
    rememberPrefersBrowser(false);
    setState("opening");
  };
  const stay = () => {
    rememberPrefersBrowser(true);
    setState("offer");
    onContinue?.();
  };

  // Chosen this browser before: one line, and no reaching for the app.
  if (state === "offer") {
    return (
      <p className="open-in-app quiet">
        <a className="link" href={link} onClick={open}>
          Open in the Stoop app
        </a>
      </p>
    );
  }
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
      <a className="provider-button" href={link} onClick={open}>
        Open in the Stoop app
      </a>
      <button type="button" className="link" onClick={stay}>
        Continue in this browser
      </button>
    </div>
  );
}
