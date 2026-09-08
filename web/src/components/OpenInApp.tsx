import { useEffect, useRef, useState } from "react";
import {
  openLinkForPath,
  prefersBrowser,
  rememberPrefersBrowser,
} from "../api/desktopLinks";
import { isDesktop } from "../api/platform";

// Hands an invite to the desktop app. The attempt fires on arrival, so
// someone who has the app lands in it, and the way back to the browser
// sits underneath. Taking that way is remembered for this server: a
// person with no app meets their browser's "open with?" dialog once and
// then never again, and is left a line to change their mind by.
// docs/architecture/desktop.md → Deep links.
export function OpenInApp({ path, quiet }: { path: string; quiet?: boolean }) {
  const link = isDesktop() ? "" : openLinkForPath(path);
  const [state, setState] = useState<"opening" | "offer">(() =>
    prefersBrowser() ? "offer" : "opening",
  );
  // The anchor below fires its own link; only the arrival needs this.
  const fired = useRef(false);

  useEffect(() => {
    if (!link || state !== "opening" || fired.current) return;
    fired.current = true;
    location.href = link;
  }, [link, state]);

  if (!link) return null;

  if (state === "offer") {
    return (
      <p className="open-in-app quiet">
        <a
          className="link"
          href={link}
          onClick={() => {
            fired.current = true;
            rememberPrefersBrowser(false);
            setState("opening");
          }}
        >
          Open in the Stoop app
        </a>
      </p>
    );
  }
  return (
    <p className={quiet ? "open-in-app quiet" : "open-in-app"}>
      <span className="muted">Opening Stoop… Not opening?</span>{" "}
      <button
        type="button"
        className="link"
        onClick={() => {
          rememberPrefersBrowser(true);
          setState("offer");
        }}
      >
        Continue in this browser
      </button>
    </p>
  );
}
