import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { useCall } from "./CallProvider";
import { sameRoom } from "./call";
import { takeRoom } from "./pendingRoom";

// Opens the call's room as its server's layout mounts, when the call
// bar asked for it from another server (components/CallBarContent.tsx):
// pushed over the tabs the swap opened on, as a tapped notification's
// channel is. Not if the call has ended or moved meanwhile.
export default function OpenCallRoom({ serverId }: { serverId: string }) {
  const router = useRouter();
  const current = useCall();
  const call = useRef(current);
  call.current = current;
  useEffect(() => {
    const room = takeRoom(serverId);
    const now = call.current;
    if (!room || !now || now.status === "failed" || !sameRoom(now.room, room)) return;
    router.push({
      pathname: "/s/[id]/space/[spaceId]/voice/[channelId]",
      params: { id: room.serverId, spaceId: room.spaceId, channelId: room.channelId },
    });
  }, [serverId, router]);
  return null;
}
