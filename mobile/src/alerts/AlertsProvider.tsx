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
import { useLoadOnReturn } from "../hooks/useLoadOnReturn";
import { useServerEvents } from "../realtime/RealtimeProvider";
import { type SavedServer, useCurrentServer, useServers } from "../servers";
import { sessionKey } from "../servers/sessionKey";
import { type AlertsLoader, alertsLoader } from "./loader";
import { type AlertsStore, alertsStore, waitingEverywhere } from "./store";

// Every saved server's badges, kept at the root of the app, inside the
// realtime provider: one loader per session (loader.ts, which says
// when it asks), on every server and not only the one on screen. A
// server's Activity and Messages tabs read their own (useAlerts), and
// the app's icon every server's total added up (useWaitingEverywhere).

const AlertsContext = createContext<AlertsStore | null>(null);

export default function AlertsProvider({ children }: { children: ReactNode }) {
  const { servers } = useServers();
  const [store] = useState(alertsStore);
  return (
    <AlertsContext.Provider value={store}>
      {servers.map((server) => (
        <ServerAlerts key={sessionKey(server)} server={server} store={store} />
      ))}
      {children}
    </AlertsContext.Provider>
  );
}

// One session's loader. It unmounts when the server is forgotten or
// signed in to again, and its badges go with it.
function ServerAlerts({ server, store }: { server: SavedServer; store: AlertsStore }) {
  const { id, origin } = server;
  const loader = useRef<AlertsLoader | null>(null);
  // Ahead of useLoadOnReturn's effect, which loads as it mounts. Made
  // once: a server's ID and origin never change under one key, so the
  // load below always asks this loader.
  useEffect(() => {
    const mine = alertsLoader({ id, origin }, (badges) => store.set(id, badges));
    loader.current = mine;
    const forget = store.setRefresh(id, mine.refresh);
    return () => {
      mine.stop();
      loader.current = null;
      forget();
      store.set(id, undefined);
    };
  }, [id, origin, store]);

  const load = useCallback(() => void loader.current?.refresh(), []);
  const readyCame = useLoadOnReturn(load);

  useServerEvents(id, (event: ServerEvent) => {
    if (event.payload.case === "ready") readyCame();
    loader.current?.event(event);
  });
  return null;
}

function useAlertsStore(): AlertsStore {
  const store = useContext(AlertsContext);
  if (!store) throw new Error("useAlerts needs an AlertsProvider above it");
  return store;
}

// The current server's two tab badges (store.ts ServerBadges), and the
// way to ask for them again.
export function useAlerts(): { activity: number; messages: number; refresh: () => Promise<void> } {
  const store = useAlertsStore();
  const { id } = useCurrentServer();
  const { activity, messages } = useSyncExternalStore(store.subscribe, () => store.badges(id));
  const refresh = useCallback(() => store.refresh(id), [store, id]);
  return useMemo(() => ({ activity, messages, refresh }), [activity, messages, refresh]);
}

// What waits on every saved server, added up (store.ts).
export function useWaitingEverywhere(): number {
  const store = useAlertsStore();
  const { servers } = useServers();
  return useSyncExternalStore(store.subscribe, () => waitingEverywhere(servers, (id) => store.badges(id).total));
}
