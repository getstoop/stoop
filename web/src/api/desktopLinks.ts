// The stoop:// links the web app hands the desktop shell. The provider
// sign-in leg has its own module (desktopAuth.ts).
// docs/architecture/desktop.md → Deep links.

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
