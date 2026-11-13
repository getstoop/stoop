import { useNavigation, useRouter, useSegments } from "expo-router";
import { useEffect, useEffectEvent, useState } from "react";
import { parseInviteLink } from "../api/invites";
import { type SavedServer, useServers } from "../servers";
import { backToServer, type ServerNavigation } from "../servers/swapServer";
import { onInvite, peekInvite, takeInvite } from "./pendingInvite";

// Opens an invite the web's open-in-app page handed over
// (pendingInvite.ts) when it is to a server this phone has saved: Add
// a space, over the server on screen, with the link in its field. That
// sheet joins as the account signed in, on this server or the other,
// and says so when the sign-in has ended (screens/AddSpace). From
// inside the server's layout, as a tapped notification is opened
// (notifications/OpenTappedNotification.tsx), so the sheet is pushed
// onto this server's own stack: whatever the root stack holds over the
// server is closed first, New message gives way, and a sheet already
// up takes the new link in place. An invite to any other server is
// left for OpenInviteLink.tsx.
// Long enough for a closing sheet to have left the screen.
const SHEET_GONE_MS = 600;

export default function OpenInviteHere({ server }: { server: SavedServer }) {
  const router = useRouter();
  const navigation = useNavigation<ServerNavigation>();
  const { servers } = useServers();
  const segments: string[] = useSegments();

  // The invite to open, until its sheet is pushed, and whether something
  // was closed to make way for it.
  const [invite, setInvite] = useState<{ link: string; closing: boolean } | null>(null);

  const hear = useEffectEvent(() => {
    const link = peekInvite();
    if (!link) return;
    const origin = parseInviteLink(link)?.origin;
    if (!servers.some((each) => each.origin === origin)) return;
    takeInvite();
    setInvite({ link, closing: segments[0] !== "s" });
    backToServer(navigation);
  });
  useEffect(() => {
    hear();
    return onInvite(hear);
  }, [server.id]);

  // The sheet is pushed once the server is the screen in front, and,
  // when a sheet was closed to get there (the switcher, a sign-in, New
  // message), once that one has gone: iOS drops a sheet presented while
  // another is still on its way out.
  const front = segments[0] === "s" ? (segments[2] ?? "") : null;
  useEffect(() => {
    if (!invite || front === null) return;
    if (front === "add-space") {
      setInvite(null);
      router.setParams({ link: invite.link });
      return;
    }
    if (front === "new-message") {
      setInvite({ link: invite.link, closing: true });
      router.dismiss();
      return;
    }
    const push = () => {
      setInvite(null);
      router.push({ pathname: "/s/[id]/add-space", params: { id: server.id, link: invite.link } });
    };
    if (!invite.closing) return push();
    const timer = setTimeout(push, SHEET_GONE_MS);
    return () => clearTimeout(timer);
  }, [invite, front, server.id, router]);

  return null;
}
