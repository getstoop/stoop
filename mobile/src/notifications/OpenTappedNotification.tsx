import { useGlobalSearchParams, useNavigation, useRouter, useSegments } from "expo-router";
import { useEffect, useRef } from "react";
import { useActivity } from "../activity/ActivityProvider";
import { type SavedServer, useServers } from "../servers";
import { backToServer, type ServerNavigation, swapServer } from "../servers/swapServer";
import { notificationRoute, placeOf } from "./open";
import { dropTap, onTap, pendingTap, takeTap } from "./pendingTap";

// Opens the tapped notification (pendingTap.ts) from inside a server's
// layout, where its stack can be pushed onto and its activity read:
// once as the layout mounts, for the tap that launched the app or
// swapped to this server, and then as each tap is heard.
//
// This server's tap is read on the way, as an Activity row is (a
// refusal holds nothing back), and opened at its message. Whatever the
// root stack holds over the server (the switcher's sheet, a sign-in)
// is closed first, as is New message, so the conversation doesn't open
// inside a sheet. On the screen it points at nothing is pushed: the
// screen goes to the message; from a thread of its channel the app
// goes back to the channel, as a search result there does. What lies
// under a closed sheet isn't looked at, so there the screen is pushed
// even if it is the one beneath.
//
// Another saved server's tap swaps to it as the switcher does, and is
// left for that server's layout. A server forgotten since drops it.
export default function OpenTappedNotification({ server }: { server: SavedServer }) {
  const router = useRouter();
  const navigation = useNavigation<ServerNavigation>();
  const { servers, switchTo } = useServers();
  const { markRead } = useActivity();
  const segments: string[] = useSegments();
  const params = useGlobalSearchParams();
  const latest = useRef({ router, navigation, servers, switchTo, markRead, segments, params });
  latest.current = { router, navigation, servers, switchTo, markRead, segments, params };

  useEffect(() => {
    const open = (mounting: boolean) => {
      const { router, navigation, servers, switchTo, markRead, segments, params } = latest.current;
      const waiting = pendingTap();
      if (!waiting) return;
      if (waiting.serverId !== server.id) {
        if (!servers.some((saved) => saved.id === waiting.serverId)) {
          dropTap();
          return;
        }
        swapServer(navigation, waiting.serverId);
        backToServer(navigation);
        switchTo(waiting.serverId).catch(() => {});
        return;
      }
      const tap = takeTap(server.id);
      if (!tap) return;
      markRead([tap.itemId]).catch(() => {});
      const route = notificationRoute(tap);
      // As it mounts the layout's stack holds nothing yet, and the
      // screen in front may still be said as the one before the swap.
      if (mounting || segments[0] !== "s") {
        backToServer(navigation);
        router.push(route);
        return;
      }
      if (segments[2] === "new-message") {
        router.dismiss();
        router.push(route);
        return;
      }
      const place = placeOf(route, segments, params);
      if (place === "here") router.setParams({ focus: tap.messageId });
      else if (place === "under") router.dismissTo(route);
      else router.push(route);
    };
    open(true);
    return onTap(() => open(false));
  }, [server.id]);

  return null;
}
