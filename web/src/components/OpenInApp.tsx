import { useEffect, useRef, useState } from "react";
import {
  openLinkForPath,
  prefersApp,
  rememberOpenInApp,
} from "../api/desktopLinks";
import { isDesktop } from "../api/platform";

// Offers to hand an invite to the desktop app. Nothing fires on a first
// visit: a browser cannot tell whether the app is installed, and firing
// blind prompts or errors where there is no handler. Once someone has
// chosen the app for this server the choice fires on load, and the way
// back to the browser sits under it and clears the choice.
// docs/architecture/desktop.md → Deep links.
export function OpenInApp({ path, quiet }: { path: string; quiet?: boolean }) {
  const link = isDesktop() ? "" : openLinkForPath(path);
  const [state, setState] = useState<"ask" | "opening" | "gone">(() =>
    prefersApp() ? "opening" : "ask",
  );
  // The anchor fires its own link; only the remembered choice needs the
  // effect below.
  const fired = useRef(false);

  useEffect(() => {
    if (!link || state !== "opening" || fired.current) return;
    fired.current = true;
    location.href = link;
  }, [link, state]);

  if (!link || state === "gone") return null;

  const stay = () => {
    rememberOpenInApp(false);
    setState("gone");
  };

  if (state === "opening") {
    return (
      <p className={wrapper(quiet)}>
        <span className="muted">Opening Stoop… Not opening?</span>{" "}
        <button type="button" className="link" onClick={stay}>
          Continue in this browser
        </button>
      </p>
    );
  }
  return (
    <div className={wrapper(quiet)}>
      <a
        className={quiet ? "link" : "provider-button"}
        href={link}
        onClick={() => {
          fired.current = true;
          rememberOpenInApp(true);
          setState("opening");
        }}
      >
        Open in the Stoop app
      </a>
      <button type="button" className="link" onClick={stay}>
        Continue in this browser
      </button>
    </div>
  );
}

const wrapper = (quiet?: boolean) =>
  quiet ? "open-in-app quiet" : "open-in-app";
