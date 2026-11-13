import { usePathname, useRouter } from "expo-router";
import { useEffect, useEffectEvent, useState } from "react";
import { parseInviteLink } from "../api/invites";
import { useServers } from "../servers";
import { onInvite, takeInvite } from "./pendingInvite";

// Opens the invite link the web's open-in-app page handed over
// (pendingInvite.ts): once as the app starts, for the link that
// launched it, and then as each is heard. An invite to a server this
// phone has saved opens Add a space over the server on screen, with
// the link in its field: that sheet joins as the account signed in,
// on this server or the other, and says so when the sign-in has ended
// (screens/AddSpace). Any other invite opens the Invite screen, to
// sign in or make an account. The server is matched by the address the
// link was opened at, as a shared link's is (OpenSharedLink.tsx).
export default function OpenInviteLink() {
  const router = useRouter();
  const pathname = usePathname();
  const { servers } = useServers();
  // The invite to open, until its screen is pushed.
  const [invite, setInvite] = useState<string | null>(null);

  const hear = useEffectEvent(() => {
    const link = takeInvite();
    if (link) setInvite(link);
  });
  useEffect(() => {
    hear();
    return onInvite(hear);
  }, []);

  // As the app starts with a server saved, the first screen ("/") is
  // on its way to that server (app/index.tsx), and a screen pushed
  // before it gets there is lost; so it waits for the server's screen.
  // With none saved "/" is Welcome, and Invite opens over it.
  const [current] = servers;
  const leaving = pathname === "/" && servers.length > 0;
  useEffect(() => {
    if (!invite || leaving) return;
    setInvite(null);
    const origin = parseInviteLink(invite)?.origin;
    const saved = current && servers.some((each) => each.origin === origin);
    if (saved) router.push({ pathname: "/s/[id]/add-space", params: { id: current.id, link: invite } });
    else router.push({ pathname: "/invite", params: { link: invite } });
  }, [invite, leaving, servers, current, router]);

  return null;
}
