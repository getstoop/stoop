// The stoop:// links the web app hands the desktop shell. The provider
// sign-in leg has its own module (desktopAuth.ts).
// docs/architecture/desktop.md → Deep links.

import { isDesktop } from "./platform";

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

// Whether this page can hand a path to the app at all: never from inside
// the shell, which is already there, and never for a path the shell
// would drop.
export function canOpenInApp(path: string): boolean {
  return !isDesktop() && openLinkForPath(path) !== "";
}

// A browser being driven by automation. It is never handed to the app on
// its own: the prompt Chrome raises for an external protocol is not
// scriptable and blocks the page the driver is working on, so every spec
// that lands on an invite would hang. The handoff still renders, and its
// button still fires.
export function underAutomation(): boolean {
  return typeof navigator !== "undefined" && navigator.webdriver === true;
}
