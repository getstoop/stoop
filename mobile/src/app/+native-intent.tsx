import * as Linking from "expo-linking";
import { normalizeServerUrl } from "../api/probe";

// Links into the app, rewritten before the router sees them. stoop://auth
// and stoop://open are also the provider sign-in hand-back, which the
// browser's auth session catches and api/signIn.ts reads; they are not
// places to go, so the app stays where it is.
//
// The one stoop://open the app follows is an invite: the web's open-in-app
// page (web/src/components/LinkHandoff.tsx) fires
// stoop://open?server=<origin>&path=/join/<code>, and it opens Invite with
// that link filled in.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | null {
  if (/^stoop:\/\/open\b/.test(path)) return inviteRoute(path);
  if (/^stoop:\/\/auth\b/.test(path)) return null;
  return path;
}

function inviteRoute(link: string): string | null {
  const { queryParams } = Linking.parse(link);
  const param = (key: string) => {
    const v = queryParams?.[key];
    return typeof v === "string" ? v : "";
  };
  const origin = normalizeServerUrl(param("server"));
  const target = param("path");
  if (!origin || !/^\/join\/[^/?#]+/.test(target)) return null;
  return `/invite?link=${encodeURIComponent(origin + target)}`;
}
