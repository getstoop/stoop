import { useGlobalSearchParams, useNavigation, useRouter, useSegments } from "expo-router";
import { useEffect, useEffectEvent } from "react";
import { useActivity } from "../activity/ActivityProvider";
import { useLastSpaceStore } from "../lastSpace/LastSpaceProvider";
import { type SavedServer, useServers } from "../servers";
import { backToServer, type ServerNavigation, swapServer } from "../servers/swapServer";
import { tapAction } from "./open";
import { dropTap, onTap, pendingTap, takeTap } from "./pendingTap";

// Opens the tapped notification (pendingTap.ts) from inside a server's
// layout, where its stack can be pushed onto and its activity read:
// once as the layout mounts, for the tap that launched the app or
// swapped to this server, and then as each tap is heard. What to do is
// decided in open.ts (tapAction); this does it. This server's tap is
// read on the way, as an Activity row is (a refusal holds nothing
// back). Another saved server's swaps to it as the switcher does, and
// is left waiting for that server's layout. A shared link is opened
// the same way (links/OpenSharedLink.tsx), with no item to mark read;
// one to a space asks the Spaces tab for it, which picks it on its
// rail if the account is in it (src/lastSpace).
export default function OpenTappedNotification({ server }: { server: SavedServer }) {
  const router = useRouter();
  const navigation = useNavigation<ServerNavigation>();
  const { servers, switchTo } = useServers();
  const { markRead } = useActivity();
  const lastSpace = useLastSpaceStore();
  const segments: string[] = useSegments();
  const params = useGlobalSearchParams();

  const open = useEffectEvent((mounting: boolean) => {
    const tap = pendingTap();
    if (!tap) return;
    const saved = servers.map((each) => each.id);
    const action = tapAction(tap, { serverId: server.id, saved, mounting, segments, params });
    if (action.do === "drop") {
      dropTap();
      return;
    }
    if (action.do === "swap") {
      swapServer(navigation, action.serverId);
      backToServer(navigation);
      switchTo(action.serverId).catch(() => {});
      return;
    }
    takeTap(server.id);
    if (action.do === "space") {
      lastSpace.ask(server.id, action.spaceId);
      backToServer(navigation);
      if (action.shown) return;
      // Back to the tabs from whatever is pushed over them, then to the
      // Spaces tab: going back alone stays on the tab it reaches.
      const spaces = { pathname: "/s/[id]/(tabs)/(spaces)", params: { id: server.id } } as const;
      router.dismissTo(spaces);
      router.navigate(spaces);
      return;
    }
    if (tap.itemId) markRead([tap.itemId]).catch(() => {});
    if (action.close === "over") backToServer(navigation);
    else if (action.close === "sheet") router.dismiss();
    // A channel jumps to the message; a thread lands only as it opens,
    // so one already in front stays where it is.
    // A link that names no message leaves the screen in front alone.
    if (action.how === "focus") {
      if (tap.messageId) router.setParams({ focus: tap.messageId });
    } else if (action.how === "back") router.dismissTo(action.route);
    else router.push(action.route);
  });

  useEffect(() => {
    open(true);
    return onTap(() => open(false));
  }, [server.id]);

  return null;
}
