import * as SecureStore from "expo-secure-store";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { setDoNotDisturb } from "../api/dnd";
import { loadMe } from "../api/me";
import { sessionToken } from "../api/servers";
import { useServerEvents } from "../realtime/RealtimeProvider";
import { type SavedServer, useServers } from "../servers";
import { sessionKey } from "../servers/sessionKey";
import { type DndStore, dndStore } from "./store";
import { DND_OFF, type DndDuration, type DndSwitch, parseSwitch, turnedOn } from "./switch";

// Do not disturb, at the root of the app inside the realtime provider:
// the phone's one switch, set on every saved server, and each server's
// own account's, which may be set from another device (store.ts for the
// rules). The switch is the phone's, so it is kept in the keychain
// beside the theme. Banners are held by it (src/notifications); badges
// and the activity list are not.

const KEY = "dnd";

const DndContext = createContext<DndStore | null>(null);

async function account(server: SavedServer) {
  const token = await sessionToken(server.id);
  if (!token) throw new Error("Signed out.");
  return loadMe(server.origin, token);
}

export default function DndProvider({ children }: { children: ReactNode }) {
  const { servers } = useServers();
  const [store] = useState(() =>
    dndStore({
      send: setDoNotDisturb,
      account,
      // A failed save only means the next launch opens on the switch before.
      save: (next) => void SecureStore.setItemAsync(KEY, JSON.stringify(next)).catch(() => {}),
      now: Date.now,
    }),
  );

  // A read the keychain refuses is off, which sets no server.
  useEffect(() => {
    SecureStore.getItemAsync(KEY)
      .catch(() => null)
      .then((raw) => store.loaded(parseSwitch(raw)));
  }, [store]);

  return (
    <DndContext.Provider value={store}>
      {servers.map((server) => (
        <ServerDnd key={sessionKey(server)} server={server} store={store} />
      ))}
      {children}
    </DndContext.Provider>
  );
}

// One session's listener. It unmounts when the server is forgotten or
// signed in to again, and what was known of its account goes with it.
function ServerDnd({ server, store }: { server: SavedServer; store: DndStore }) {
  useEffect(() => () => store.forget(server.id), [server.id, store]);
  useServerEvents(server.id, ({ payload }) => {
    if (payload.case === "ready") store.connected(server);
    else if (payload.case === "doNotDisturbChanged")
      store.accountChanged(server.id, { dnd: payload.value.dnd, dndUntil: payload.value.until });
  });
  return null;
}

function useDndStore(): DndStore {
  const store = useContext(DndContext);
  if (!store) throw new Error("useDndSwitch needs a DndProvider above it");
  return store;
}

// The phone's switch as it reads now, and the way to move it: off, or
// on for a duration counted from now. Drawn again the moment its end
// passes, which nothing else says.
export function useDndSwitch(): [DndSwitch, (next: DndDuration | "off") => void] {
  const store = useDndStore();
  const { servers } = useServers();
  const current = useSyncExternalStore(store.subscribe, store.current);
  const end = current.on ? current.until : null;
  const [, redraw] = useState(0);
  useEffect(() => {
    if (end === null) return;
    const timer = setTimeout(() => redraw((count) => count + 1), Math.max(0, end - Date.now()));
    return () => clearTimeout(timer);
  }, [end]);

  const change = useCallback(
    (next: DndDuration | "off") => store.set(next === "off" ? DND_OFF : turnedOn(next, Date.now()), servers),
    [store, servers],
  );
  return [current, change];
}

// Whether a server's banners are held right now (store.ts holds), to
// ask as each one arrives.
export function useDndHolds(): (serverId: string) => boolean {
  return useDndStore().holds;
}
