import { Code, ConnectError } from "@connectrpc/connect";
import { alertingTotal } from "@stoop/core/alerts";
import type { ServerEvent } from "@stoop/gen/stoop/realtime/v1/realtime_pb";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { loadAlertLists, touchesAlerts } from "../api/alerts";
import { sessionToken } from "../api/servers";
import { useLoadOnReturn } from "../hooks/useLoadOnReturn";
import { useServerEvents } from "../realtime/RealtimeProvider";
import type { SavedServer } from "../servers";

// One server's badge total for the Activity tab (core/alerts
// alertingTotal): the server's counts on its spaces and conversations
// (api/alerts), asked for again rather than kept up here. Loaded on
// mounting and on the socket's Ready (a reconnect, which coming back to
// the app brings; a few seconds without one load anyway), and again,
// after a moment's quiet, on any event that could change it
// (touchesAlerts) or when a screen says so (the Messages tab closing a
// conversation, which no event tells). A load that fails keeps the last
// total. CredentialRevoked says the session has ended: nothing more is
// asked, and there is no badge.

type Store = {
  total: number;
  // Asks the server again; resolves once the answer has landed.
  refresh: () => Promise<void>;
};

const AlertsContext = createContext<Store | null>(null);

// Events come in bursts (a message sent is also its channel read), so a
// moment's quiet goes before one load.
const RELOAD_DELAY_MS = 300;

const unauthenticated = (err: unknown) => err instanceof ConnectError && err.code === Code.Unauthenticated;

export default function AlertsProvider({ server, children }: { server: SavedServer; children: ReactNode }) {
  const [total, setTotal] = useState(0);
  // Loads can overlap (opening, Ready, an event), and an older one
  // finishing last must not undo a newer one: only the latest started
  // counts, and unmounting makes none the latest.
  const latest = useRef(0);
  const ended = useRef(false);
  const reload = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const end = useCallback(() => {
    ended.current = true;
    latest.current++;
    clearTimeout(reload.current);
    setTotal(0);
  }, []);

  const refresh = useCallback(async () => {
    if (ended.current) return;
    const mine = ++latest.current;
    const session = await sessionToken(server.id).catch(() => null);
    if (mine !== latest.current) return;
    if (!session) {
      end();
      return;
    }
    try {
      const { spaces, dms } = await loadAlertLists(server.origin, session);
      if (mine === latest.current) setTotal(alertingTotal(spaces, dms));
    } catch (err) {
      if (unauthenticated(err)) end();
    }
  }, [server, end]);

  const readyCame = useLoadOnReturn(refresh);
  useEffect(
    () => () => {
      latest.current++;
      clearTimeout(reload.current);
    },
    [],
  );

  useServerEvents(server.id, (event: ServerEvent) => {
    if (event.payload.case === "credentialRevoked") {
      end();
      return;
    }
    if (event.payload.case === "ready") readyCame();
    if (!touchesAlerts(event)) return;
    clearTimeout(reload.current);
    reload.current = setTimeout(refresh, RELOAD_DELAY_MS);
  });

  const store = useMemo(() => ({ total, refresh }), [total, refresh]);
  return <AlertsContext.Provider value={store}>{children}</AlertsContext.Provider>;
}

// The current server's badge total, and the way to ask for it again.
export function useAlerts(): Store {
  const store = useContext(AlertsContext);
  if (!store) throw new Error("useAlerts needs an AlertsProvider above it");
  return store;
}
