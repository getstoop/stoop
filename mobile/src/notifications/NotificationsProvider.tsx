import type { ActivityItem } from "@stoop/gen/stoop/chat/v1/activity_pb";
import type { ServerEvent } from "@stoop/gen/stoop/realtime/v1/realtime_pb";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { loadChannelList, loadSpaceList } from "../api/activity";
import { sessionToken } from "../api/servers";
import { useServerEvents } from "../realtime/RealtimeProvider";
import { type SavedServer, useServers } from "../servers";
import { sessionKey } from "../servers/sessionKey";
import AppIconBadge from "./AppIconBadge";
import { readOfPlace } from "./clear";
import { notificationContent } from "./content";
import { dismissNotifications } from "./dismiss";
import { focusedPlace, onFocusedPlace } from "./focus";
import { placesCache } from "./places";
import { present } from "./present";
import { staysQuiet } from "./quiet";
import { useNotificationTaps } from "./taps";

// Rings for what happens to the person while the app is in front: a
// system notification for each activity item a saved server's socket
// delivers (a mention, a reply, a thread's reply, a direct message), on
// every server, not only the one on screen. Only ActivityItemCreated
// rings: what a load of the feed brings after a reconnect is history.
// Nothing is said for what is muted, read, or being read as it arrives
// (quiet.ts).
//
// A notification stays in the system's list only while what it points
// at is unread (clear.ts for which, dismiss.ts for the taking out): a
// channel or a thread coming on screen clears its own, which coming
// back to the app on one does again, as does its read marker moving,
// on this device or another; a session's all go when it ends or its
// server is forgotten. A read that lands while a notification still
// waits for its names doesn't stop it showing. Tapping one is heard
// here too (taps.ts) and opened by the server's layout. The app's icon
// badge is kept from here as well (AppIconBadge.tsx).
export default function NotificationsProvider({ children }: { children: ReactNode }) {
  const { servers } = useServers();
  useNotificationTaps(servers);
  useEffect(() => onFocusedPlace((place) => void dismissNotifications(readOfPlace(place))), []);
  return (
    <>
      <AppIconBadge />
      {servers.map((server) => (
        <ServerNotifications key={sessionKey(server)} server={server} manyServers={servers.length > 1} />
      ))}
      {children}
    </>
  );
}

// One session's listener, with the names of its places (places.ts)
// kept for as long as the session is. It unmounts when the server is
// forgotten or signed in to again, and the session's notifications go
// with it.
function ServerNotifications({ server, manyServers }: { server: SavedServer; manyServers: boolean }) {
  const [places] = useState(() => {
    const token = async () => {
      const session = await sessionToken(server.id);
      if (!session) throw new Error("Signed out.");
      return session;
    };
    return placesCache({
      spaces: async () => loadSpaceList(server.origin, await token()),
      channels: async (spaceId) => loadChannelList(server.origin, await token(), spaceId),
    });
  });
  // Whether the session still is: not once this unmounts, nor once its
  // credential is revoked, which leaves the server saved and this here.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      void dismissNotifications({ serverId: server.id, all: true });
    };
  }, [server.id]);

  const ring = (item: ActivityItem) => {
    const { channelId, threadRootId, muted } = item;
    const arrival = { serverId: server.id, channelId, threadRootId, muted, read: !!item.readAt };
    if (staysQuiet(arrival, focusedPlace())) return;
    places
      .names(item)
      .then((names) => {
        // The wait for the names may have seen the session end, or the
        // person open where this landed.
        if (!live.current || staysQuiet(arrival, focusedPlace())) return;
        return present(notificationContent(item, server, names, manyServers));
      })
      // A notification that can't be shown is dropped.
      .catch(() => {});
  };

  useServerEvents(server.id, ({ payload }: ServerEvent) => {
    switch (payload.case) {
      case "activityItemCreated":
        if (payload.value.item) ring(payload.value.item);
        break;
      case "channelRead":
        void dismissNotifications({ serverId: server.id, channelId: payload.value.channelId });
        break;
      case "threadRead":
        void dismissNotifications({ serverId: server.id, threadRootId: payload.value.rootMessageId });
        break;
      case "credentialRevoked":
        live.current = false;
        void dismissNotifications({ serverId: server.id, all: true });
        break;
    }
  });
  return null;
}
