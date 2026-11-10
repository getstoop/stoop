import type { ServerEvent } from "@stoop/gen/stoop/realtime/v1/realtime_pb";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { loadChannelList, loadSpaceList } from "../api/activity";
import { sessionToken } from "../api/servers";
import { useServerEvents } from "../realtime/RealtimeProvider";
import { type SavedServer, useServers } from "../servers";
import { sessionKey } from "../servers/sessionKey";
import { readOfPlace } from "./clear";
import { clearNotifications } from "./clearNotifications";
import { notificationContent } from "./content";
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
// at is unread (clear.ts): a channel or a thread coming on screen clears
// its own, as does its read marker moving, on this device or another;
// a session's all go when it ends or its server is forgotten. Tapping
// one is heard here too (taps.ts) and opened by the server's layout.
export default function NotificationsProvider({ children }: { children: ReactNode }) {
  const { servers } = useServers();
  useNotificationTaps(servers);
  useEffect(() => onFocusedPlace((place) => void clearNotifications(readOfPlace(place))), []);
  return (
    <>
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
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void clearNotifications({ serverId: server.id, all: true });
    };
  }, [server.id]);

  useServerEvents(server.id, (event: ServerEvent) => {
    const { payload } = event;
    if (payload.case === "channelRead") {
      void clearNotifications({ serverId: server.id, channelId: payload.value.channelId });
    } else if (payload.case === "threadRead") {
      void clearNotifications({ serverId: server.id, threadRootId: payload.value.rootMessageId });
    } else if (payload.case === "credentialRevoked") {
      void clearNotifications({ serverId: server.id, all: true });
    }
    if (payload.case !== "activityItemCreated") return;
    const item = payload.value.item;
    if (!item) return;
    const { channelId, threadRootId, muted } = item;
    const arrival = { serverId: server.id, channelId, threadRootId, muted, read: !!item.readAt };
    if (staysQuiet(arrival, focusedPlace())) return;
    places
      .names(item)
      .then((names) => {
        // The wait for the names may have seen the server forgotten or
        // signed in to again, or the person open where this landed.
        if (!mounted.current || staysQuiet(arrival, focusedPlace())) return;
        return present(notificationContent(item, server, names, manyServers));
      })
      // A notification that can't be shown is dropped.
      .catch(() => {});
  });
  return null;
}
