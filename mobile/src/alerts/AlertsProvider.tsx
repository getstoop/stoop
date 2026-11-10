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

// Every saved server's badge total, kept at the root of the app, inside
// the realtime provider: one loader per session (loader.ts), on every
// server and not only the one on screen, so that the app's icon can
// show them added up (src/notifications/AppIconBadge.tsx). A server's
// Activity tab reads its own (useAlerts). Each is loaded on mounting
// and on the socket's Ready (a reconnect, which coming back to the app
// brings; a few seconds without one load anyway), and again, after a
// moment's quiet, on any event of its own socket that could change it.

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
// signed in to again, and its total goes with it.
function ServerAlerts({ server, store }: { server: SavedServer; store: AlertsStore }) {
  const { id, origin } = server;
  const loader = useRef<AlertsLoader | null>(null);
  // Ahead of useLoadOnReturn's effect, which loads as it mounts.
  useEffect(() => {
    const mine = alertsLoader({ id, origin }, (total) => store.set(id, total));
    loader.current = mine;
    const forget = store.loadWith(id, mine.refresh);
    return () => {
      mine.stop();
      loader.current = null;
      forget();
      store.set(id, undefined);
    };
  }, [id, origin, store]);

  const refresh = useCallback(() => void loader.current?.refresh(), []);
  const readyCame = useLoadOnReturn(refresh);

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

// The current server's badge total, and the way to ask for it again.
export function useAlerts(): { total: number; refresh: () => Promise<void> } {
  const store = useAlertsStore();
  const { id } = useCurrentServer();
  const total = useSyncExternalStore(store.subscribe, () => store.total(id));
  const refresh = useCallback(() => store.refresh(id), [store, id]);
  return useMemo(() => ({ total, refresh }), [total, refresh]);
}

// What waits on every saved server, added up (store.ts).
export function useWaitingEverywhere(): number {
  const store = useAlertsStore();
  const { servers } = useServers();
  return useSyncExternalStore(store.subscribe, () => waitingEverywhere(servers, store.total));
}
