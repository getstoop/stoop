import * as Linking from "expo-linking";
import { normalizeServerUrl } from "../api/probe";
import { heardLink } from "../links/pendingLink";
import { sharedLink } from "../links/sharedLink";

// Links into the app, rewritten before the router sees them. stoop://auth
// and stoop://open are also the provider sign-in hand-back, which the
// browser's auth session catches and api/signIn.ts reads; they are not
// places to go, so the app stays where it is.
//
// The stoop://open the app follows is the web's open-in-app page
// (web/src/components/LinkHandoff.tsx) handing a shared link over:
// stoop://open?server=<origin>&path=<the web's path>. An invite
// (/join/<code>) opens Invite with that link filled in. A space, a
// channel, a message or a thread is not a route yet: which saved server
// it belongs to isn't known here, so it is left for the app to open
// once it is (links/OpenSharedLink.tsx), and the router is told nothing.
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
  if (origin && /^\/join\/[^/?#]+/.test(target)) return `/invite?link=${encodeURIComponent(origin + target)}`;
  const shared = sharedLink(param("server"), target);
  if (shared) heardLink(shared);
  return null;
}
