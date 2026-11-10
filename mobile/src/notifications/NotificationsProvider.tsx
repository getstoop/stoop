import type { ServerEvent } from "@stoop/gen/stoop/realtime/v1/realtime_pb";
import { type ReactNode, useState } from "react";
import { loadChannelList, loadSpaceList } from "../api/activity";
import { sessionToken } from "../api/servers";
import { useServerEvents } from "../realtime/RealtimeProvider";
import { type SavedServer, useServers } from "../servers";
import { sessionKey } from "../servers/sessionKey";
import { notificationContent } from "./content";
import { focusedPlace } from "./focus";
import { placesCache } from "./places";
import { present } from "./present";
import { staysQuiet } from "./quiet";

// Rings for what happens to the person while the app is in front: a
// system notification for each activity item a saved server's socket
// delivers (a mention, a reply, a thread's reply, a direct message), on
// every server, not only the one on screen. Only ActivityItemCreated
// rings: what a load of the feed brings after a reconnect is history.
// Nothing is said for what is muted, read, or being read as it arrives
// (quiet.ts).
export default function NotificationsProvider({ children }: { children: ReactNode }) {
  const { servers } = useServers();
  return (
    <>
      {servers.map((server) => (
        <ServerRing key={sessionKey(server)} server={server} manyServers={servers.length > 1} />
      ))}
      {children}
    </>
  );
}

// One session's listener, with the names of its places (places.ts)
// kept for as long as the session is.
function ServerRing({ server, manyServers }: { server: SavedServer; manyServers: boolean }) {
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

  useServerEvents(server.id, (event: ServerEvent) => {
    if (event.payload.case !== "activityItemCreated") return;
    const item = event.payload.value.item;
    if (!item) return;
    const { channelId, threadRootId, muted } = item;
    if (staysQuiet({ serverId: server.id, channelId, threadRootId, muted, read: !!item.readAt }, focusedPlace())) return;
    places
      .names(item)
      .then((names) => present(notificationContent(item, server, names, manyServers)))
      // A notification that can't be shown is dropped.
      .catch(() => {});
  });
  return null;
}
