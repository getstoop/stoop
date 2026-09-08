// The stoop:// links the web app hands the desktop shell, and whether
// this browser has been told to use them. The provider sign-in leg has
// its own module (desktopAuth.ts).
// docs/architecture/desktop.md → Deep links.

// Set when someone chooses the app for an invite, cleared when they
// choose the browser. localStorage is per-origin, so a choice made on
// one server never speaks for another.
const OPEN_IN_APP_KEY = "stoop.openInApp";

// stoop://open for a path on this server. The shell matches the origin
// exactly and offers to add a server it does not have, holding the path
// until the person confirms.
export function openLinkForPath(path: string): string {
  // The shell's own parser refuses these; refuse them here too rather
  // than fire a link it will drop.
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    return "";
  }
  return `stoop://open?${new URLSearchParams({
    server: location.origin,
    path,
  })}`;
}

export function prefersApp(): boolean {
  try {
    return localStorage.getItem(OPEN_IN_APP_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberOpenInApp(prefer: boolean) {
  try {
    if (prefer) localStorage.setItem(OPEN_IN_APP_KEY, "1");
    else localStorage.removeItem(OPEN_IN_APP_KEY);
  } catch {
    // Storage unavailable: the offer asks again next time.
  }
}
