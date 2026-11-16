import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { loadSpaceChannels, memberName } from "../api/channels";
import { loadMe } from "../api/me";
import { sessionToken } from "../api/servers";
import { useEventSubscription } from "../realtime/RealtimeProvider";
import { touchesRoom } from "../screens/VoiceRoom/stageRules";
import { useServers } from "../servers";
import type { CallRoom } from "./call";
import type { CallPlace } from "./callBar";

const CallPlaceContext = createContext<CallPlace | undefined>(undefined);

const RELOAD_DELAY_MS = 300;
// A load that failed, or could not say who this account is, is tried
// again this long after, then twice as long, this many times.
const RETRY_FIRST_MS = 2000;
const RETRIES = 4;

// The names the call bar needs of the call's room (callBar.ts
// CallPlace), loaded once for every bar, whichever server is on screen:
// when the call starts, and again, after a moment's quiet, when the
// call's server says the room, its space or its members changed, or its
// socket reconnects. A load that fails keeps what it had and is tried
// again a few times. `room` is the call's while the bar shows, else
// undefined.
export default function CallPlaceProvider({ room, children }: { room: CallRoom | undefined; children: ReactNode }) {
  const { servers } = useServers();
  const subscribe = useEventSubscription();
  const server = servers.find((saved) => saved.id === room?.serverId);
  const origin = server?.origin;
  const [place, setPlace] = useState<CallPlace>();

  useEffect(() => {
    setPlace(undefined);
    if (!room || !origin) return;
    let latest = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let meId = "";
    const load = async (retries: number) => {
      latest += 1;
      const mine = latest;
      clearTimeout(timer);
      let whole = false;
      try {
        const token = await sessionToken(room.serverId);
        if (!token) return;
        const [{ space, voice, members }, me] = await Promise.all([
          loadSpaceChannels(origin, token, room.spaceId),
          meId ? undefined : loadMe(origin, token).catch(() => undefined),
        ]);
        if (mine !== latest) return;
        meId = me?.id ?? meId;
        whole = !!meId;
        setPlace({
          roomName: voice.find((channel) => channel.id === room.channelId)?.name ?? "",
          spaceName: space.name,
          meId,
          names: Object.fromEntries(Object.entries(members).map(([userId, member]) => [userId, memberName(member)])),
        });
      } catch {
        // Keeps what it had.
      }
      if (whole || mine !== latest || retries === 0) return;
      timer = setTimeout(() => void load(retries - 1), RETRY_FIRST_MS * 2 ** (RETRIES - retries));
    };
    void load(RETRIES);
    const stop = subscribe(room.serverId, (event) => {
      if (!touchesRoom(event, room.spaceId)) return;
      clearTimeout(timer);
      timer = setTimeout(() => void load(RETRIES), RELOAD_DELAY_MS);
    });
    return () => {
      latest += 1;
      clearTimeout(timer);
      stop();
    };
  }, [room, origin, subscribe]);

  return <CallPlaceContext.Provider value={place}>{children}</CallPlaceContext.Provider>;
}

// What is known of the call's room, or undefined before it has loaded
// and with no call.
export function useCallPlace(): CallPlace | undefined {
  return useContext(CallPlaceContext);
}
