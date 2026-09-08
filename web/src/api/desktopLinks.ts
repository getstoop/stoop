// The stoop:// links the web app hands the desktop shell, and whether
// this browser has asked to be left alone. The provider sign-in leg has
// its own module (desktopAuth.ts).
// docs/architecture/desktop.md → Deep links.

// Set when someone takes the way back to the browser. localStorage is
// per-origin, so a choice made on one server never speaks for another.
const IN_BROWSER_KEY = "stoop.inviteInBrowser";

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

export function prefersBrowser(): boolean {
  try {
    return localStorage.getItem(IN_BROWSER_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberPrefersBrowser(prefer: boolean) {
  try {
    if (prefer) localStorage.setItem(IN_BROWSER_KEY, "1");
    else localStorage.removeItem(IN_BROWSER_KEY);
  } catch {
    // Storage unavailable: the attempt is made again next time.
  }
}
