import * as Linking from "expo-linking";
import { normalizeServerUrl } from "../api/probe";
import { heardInvite } from "../links/pendingInvite";
import { heardLink } from "../links/pendingLink";
import { sharedLink } from "../links/sharedLink";

// Links into the app, rewritten before the router sees them. stoop://auth
// and stoop://open are also the provider sign-in hand-back, which the
// browser's auth session catches and api/signIn.ts reads; they are not
// places to go, so the app stays where it is.
//
// The stoop://open the app follows is the web's open-in-app page
// (web/src/components/LinkHandoff.tsx) handing a shared link over:
// stoop://open?server=<origin>&path=<the web's path>. None of it is a
// route yet: whether the phone has the server saved isn't known here,
// so an invite (/join/<code>) is left for links/OpenInviteLink.tsx
// (Add a space when it has, the Invite screen when not), and a space, a
// channel, a message or a thread for links/OpenSharedLink.tsx, to open
// once it is; the router is told nothing.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | null {
  if (/^stoop:\/\/open\b/.test(path)) return openRoute(path);
  if (/^stoop:\/\/auth\b/.test(path)) return null;
  return path;
}

function openRoute(link: string): string | null {
  const { queryParams } = Linking.parse(link);
  const param = (key: string) => {
    const v = queryParams?.[key];
    return typeof v === "string" ? v : "";
  };
  const origin = normalizeServerUrl(param("server"));
  const target = param("path");
  if (origin && /^\/join\/[^/?#]+/.test(target)) {
    heardInvite(origin + target);
    return null;
  }
  const shared = sharedLink(param("server"), target);
  if (shared) heardLink(shared);
  return null;
}
