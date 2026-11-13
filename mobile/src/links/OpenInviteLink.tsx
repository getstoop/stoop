import { usePathname, useRouter } from "expo-router";
import { useEffect, useEffectEvent, useState } from "react";
import { parseInviteLink } from "../api/invites";
import { useServers } from "../servers";
import { onInvite, peekInvite, takeInvite } from "./pendingInvite";

// Opens the invite link the web's open-in-app page handed over
// (pendingInvite.ts) when it is to a server this phone hasn't saved:
// the Invite screen, to sign in or make an account. Once as the app
// starts, for the link that launched it, and then as each is heard. An
// invite to a saved server is left for that server's layout
// (OpenInviteHere.tsx), which opens Add a space. The server is matched
// by the address the link was opened at, as a shared link's is
// (OpenSharedLink.tsx).
export default function OpenInviteLink() {
  const router = useRouter();
  const pathname = usePathname();
  const { servers } = useServers();
  // The invite to open, until its screen is pushed.
  const [invite, setInvite] = useState<string | null>(null);

  const hear = useEffectEvent(() => {
    const link = peekInvite();
    if (!link) return;
    const origin = parseInviteLink(link)?.origin;
    if (servers.some((each) => each.origin === origin)) return;
    takeInvite();
    setInvite(link);
  });
  useEffect(() => {
    hear();
    return onInvite(hear);
  }, []);

  // As the app starts with a server saved, the first screen ("/") is
  // on its way to that server (app/index.tsx), and a screen pushed
  // before it gets there is lost; so it waits for the server's screen.
  // With none saved "/" is Welcome, and Invite opens over it. An Invite
  // screen already in front takes the new link in place.
  const leaving = pathname === "/" && servers.length > 0;
  useEffect(() => {
    if (!invite || leaving) return;
    setInvite(null);
    if (pathname === "/invite") router.setParams({ link: invite });
    else router.push({ pathname: "/invite", params: { link: invite } });
  }, [invite, leaving, pathname, router]);

  return null;
}
