import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import { sessionToken } from "../api/servers";
import { useServers } from "../servers";
import { openRealtime, type Realtime } from "./socket";
import { applyVoiceEvent, type VoiceRoster } from "./voice";

// By server ID: who is in voice there, or undefined while its socket is
// not connected and nobody can say.
const VoiceContext = createContext<Record<string, VoiceRoster | undefined>>({});

// Holds a realtime socket to every server on the phone while the app is
// in the foreground, so the person shows online, on mobile, everywhere
// they are signed in, not only on the server on screen. Leaving the
// foreground closes them all at once; the server keeps the person online
// for its grace period, so a quick trip to another app doesn't flicker.
// What the sockets carry is kept here as screens come to need it: so far,
// who is in each voice room.
export default function RealtimeProvider({ children }: { children: ReactNode }) {
  const { servers } = useServers();
  // Switching servers reorders the list; only a server added or forgotten
  // changes which sockets there are.
  const key = servers
    .map((server) => `${server.id} ${server.origin}`)
    .sort()
    .join("\n");
  const targets = useMemo(
    () =>
      key
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [id, origin] = line.split(" ");
          return { id, origin };
        }),
    [key],
  );
  const [active, setActive] = useState(AppState.currentState === "active");
  const [voice, setVoice] = useState<Record<string, VoiceRoster | undefined>>({});

  // "inactive" is a moment between (the app switcher, a system sheet):
  // only going to the background closes the sockets.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") setActive(true);
      else if (state === "background") setActive(false);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!active) return;
    const sockets: Realtime[] = targets.map((server) =>
      openRealtime(
        server.origin,
        () => sessionToken(server.id),
        (event) =>
          setVoice((all) => {
            const roster = applyVoiceEvent(all[server.id], event);
            return roster === all[server.id] ? all : { ...all, [server.id]: roster };
          }),
        () => setVoice((all) => (all[server.id] ? { ...all, [server.id]: undefined } : all)),
      ),
    );
    return () => {
      for (const socket of sockets) socket.close();
    };
  }, [targets, active]);

  return <VoiceContext.Provider value={voice}>{children}</VoiceContext.Provider>;
}

// Who is in voice on a server, or undefined while that isn't known.
export function useVoiceRoster(serverId: string): VoiceRoster | undefined {
  return useContext(VoiceContext)[serverId];
}
