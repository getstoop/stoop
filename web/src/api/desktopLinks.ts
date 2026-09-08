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
// would drop. Callers that stand something aside for the handoff have to
// ask, or they stand it aside for a handoff that never renders.
export function canOpenInApp(path: string): boolean {
  return !isDesktop() && openLinkForPath(path) !== "";
}
