import type { ServerEvent } from "@stoop/gen/stoop/realtime/v1/realtime_pb";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AppState } from "react-native";
import { sessionToken } from "../api/servers";
import { useServers } from "../servers";
import { applyPresenceEvent, type Presence, presenceOf, type PresenceRoster } from "./presence";
import { type RosterStore, rosterStore } from "./rosterStore";
import { openRealtime, type Realtime } from "./socket";
import { socketKey } from "./socketKey";
import { applyVoiceEvent, type VoiceRoster } from "./voice";

// Who is in voice on each server.
const VoiceContext = createContext<RosterStore<VoiceRoster>>(rosterStore());
// Who is online on each server.
const PresenceContext = createContext<RosterStore<PresenceRoster>>(rosterStore());

type Listener = (event: ServerEvent) => void;
export type Subscribe = (serverId: string, listener: Listener) => () => void;
// By server ID: what each screen listening there is handed, every event.
type Listeners = Map<string, Set<Listener>>;
const ListenersContext = createContext<Listeners>(new Map());

// Holds a realtime socket to every server on the phone while the app is
// in the foreground, so the person shows online, on mobile, everywhere
// they are signed in, not only on the server on screen. Leaving the
// foreground closes them all at once; the server keeps the person online
// for its grace period, so a quick trip to another app doesn't flicker.
// Who is in each voice room and who is online are kept here; a screen
// that needs other events listens for them with useServerEvents.
export default function RealtimeProvider({ children }: { children: ReactNode }) {
  const { servers } = useServers();
  const key = socketKey(servers);
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
  const [voice] = useState(() => rosterStore<VoiceRoster>());
  const [presence] = useState(() => rosterStore<PresenceRoster>());
  const listeners = useRef<Listeners>(new Map()).current;

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
        (event) => {
          voice.set(server.id, applyVoiceEvent(voice.get(server.id), event));
          presence.set(server.id, applyPresenceEvent(presence.get(server.id), event));
          for (const listener of listeners.get(server.id) ?? []) listener(event);
        },
        () => {
          voice.set(server.id, undefined);
          presence.set(server.id, undefined);
        },
      ),
    );
    return () => {
      for (const socket of sockets) socket.close();
      // Closed sockets say nothing more, so their rosters are cleared here.
      for (const server of targets) {
        voice.set(server.id, undefined);
        presence.set(server.id, undefined);
      }
    };
  }, [targets, active, listeners, voice, presence]);

  return (
    <ListenersContext.Provider value={listeners}>
      <VoiceContext.Provider value={voice}>
        <PresenceContext.Provider value={presence}>{children}</PresenceContext.Provider>
      </VoiceContext.Provider>
    </ListenersContext.Provider>
  );
}

// Hands onEvent every event from a server's socket while the calling
// screen is mounted. Ready counts too: it follows a reconnect, after
// which anything loaded before may have missed something.
export function useServerEvents(serverId: string, onEvent: Listener) {
  const subscribe = useEventSubscription();
  const latest = useRef(onEvent);
  latest.current = onEvent;
  useEffect(() => subscribe(serverId, (event) => latest.current(event)), [subscribe, serverId]);
}

// The same outside a component's lifetime: what listens for as long as
// it needs (a channel's log, which more than one screen holds) subscribes
// with this and is handed the way to stop.
export function useEventSubscription(): Subscribe {
  const listeners = useContext(ListenersContext);
  return useCallback(
    (serverId: string, listener: Listener) => {
      const forServer = listeners.get(serverId) ?? new Set<Listener>();
      listeners.set(serverId, forServer);
      forServer.add(listener);
      return () => {
        forServer.delete(listener);
      };
    },
    [listeners],
  );
}

// Who is in voice on a server, or undefined while that isn't known.
export function useVoiceRoster(serverId: string): VoiceRoster | undefined {
  const store = useContext(VoiceContext);
  return useSyncExternalStore(store.subscribe, () => store.get(serverId));
}

// Whether someone on a server is online, on do not disturb, or online only
// in a mobile app, or undefined while that isn't known: the socket is not
// connected, or has not said yet. Anyone who shares a space with this
// account can be asked about; anyone else reads as offline. Re-renders the
// caller only when this answer changes, not for anyone else or any other server.
export function usePresence(serverId: string, userId: string | undefined): Presence | undefined {
  const store = useContext(PresenceContext);
  return useSyncExternalStore(store.subscribe, () => presenceOf(store.get(serverId), userId));
}
