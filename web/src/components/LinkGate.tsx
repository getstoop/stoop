import { type ReactNode, useState } from "react";
import { canOpenInApp } from "../api/desktopLinks";
import { sharedLinkKind } from "../api/shareLinks";
import { LinkHandoff } from "./LinkHandoff";

// A shared link in a browser asks first: the app, or here. This wraps the
// whole route tree, so nothing beneath it has mounted by the time the
// choice is made — no invite looked up or redeemed, no channel opened and
// marked read. The answer lasts as long as the page is loaded (this
// component is never unmounted) and nothing is stored, so a fresh load
// asks again.
// docs/architecture/desktop.md → Deep links.
export function LinkGate({ children }: { children: ReactNode }) {
  // Where the browser landed, read once. A shared link is arrived at, not
  // navigated to: following the router's location instead would raise the
  // gate every time someone opened a channel from the sidebar.
  const [entry] = useState(() => ({
    pathname: location.pathname,
    search: location.search,
  }));
  const [inBrowser, setInBrowser] = useState(false);
  const kind = sharedLinkKind(entry.pathname, entry.search);
  const path = `${entry.pathname}${entry.search}`;

  if (kind === "" || inBrowser || !canOpenInApp(path)) return <>{children}</>;
  return (
    <LinkHandoff
      path={path}
      kind={kind}
      onContinue={() => setInBrowser(true)}
    />
  );
}
