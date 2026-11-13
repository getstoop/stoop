import { usePathname, useRouter } from "expo-router";
import { useEffect, useEffectEvent, useState } from "react";
import { acceptTap } from "../notifications/pendingTap";
import { useServers } from "../servers";
import { onLink, takeLink } from "./pendingLink";

// Opens the shared link the web's open-in-app page handed over
// (pendingLink.ts): once as the app starts, for the link that launched
// it, and then as each is heard. A link to a saved server is opened as
// a tapped notification is, by that server's layout
// (notifications/OpenTappedNotification.tsx): the same swap of servers,
// the same closing of what is in the way, the channel at the message.
// A link to a space asks the Spaces tab for it (src/lastSpace).
// A link to a server this phone isn't signed in to opens Sign in for
// it, and goes no further. The server is matched by the address the
// link was opened at, so one saved under another address (the LAN's)
// counts as not saved.
export default function OpenSharedLink() {
  const router = useRouter();
  const pathname = usePathname();
  const { servers } = useServers();
  // The address to sign in to, until Sign in is pushed.
  const [signIn, setSignIn] = useState<string | null>(null);

  const open = useEffectEvent(() => {
    const link = takeLink();
    if (!link) return;
    const { origin, ...where } = link;
    const server = servers.find((each) => each.origin === origin);
    if (server) acceptTap(null, { serverId: server.id, ...where });
    else setSignIn(origin);
  });

  useEffect(() => {
    open();
    return onLink(open);
  }, []);

  // As the app starts with a server saved, the first screen ("/") is
  // on its way to that server (app/index.tsx), and a Sign in pushed
  // before it gets there is lost; so it waits for the server's screen.
  // With none saved "/" is Welcome, and Sign in opens over it.
  const leaving = pathname === "/" && servers.length > 0;
  useEffect(() => {
    if (!signIn || leaving) return;
    setSignIn(null);
    router.push({ pathname: "/sign-in", params: { server: signIn } });
  }, [signIn, leaving, router]);

  return null;
}
