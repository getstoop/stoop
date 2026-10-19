import { createContext, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { forgetServer, loadServers, type SavedServer, saveSignIn } from "../api/servers";

type ServersState = {
  servers: SavedServer[];
  // Keeps a new session and returns the server's local ID.
  signedIn: (origin: string, name: string, token: string) => Promise<string>;
  forget: (id: string) => Promise<void>;
};

export const ServersContext = createContext<ServersState | null>(null);

// Holds the saved servers for the whole app, read from the keychain once
// at launch. Nothing under it renders until that read is done, so a
// route's guard never mistakes "not loaded yet" for "no such server".
export default function ServersProvider({ children }: { children: ReactNode }) {
  const [servers, setServers] = useState<SavedServer[] | null>(null);
  // Changes run one at a time, each on the list the one before it left,
  // so two that overlap (a slow sign-in finishing after another) can't
  // each save a list missing the other's server.
  const latest = useRef<SavedServer[]>([]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    loadServers()
      .catch(() => [])
      .then((list) => {
        latest.current = list;
        setServers(list);
      });
  }, []);

  const change = useCallback((apply: (list: SavedServer[]) => Promise<SavedServer[]>) => {
    const next = queue.current.then(async () => {
      const list = await apply(latest.current);
      latest.current = list;
      setServers(list);
      return list;
    });
    queue.current = next.catch(() => {});
    return next;
  }, []);

  const signedIn = useCallback(
    async (origin: string, name: string, token: string) => {
      // saveSignIn puts the server it saved first.
      const list = await change((list) => saveSignIn(list, origin, name, token));
      return list[0].id;
    },
    [change],
  );

  const forget = useCallback(
    async (id: string) => {
      await change((list) => forgetServer(list, id));
    },
    [change],
  );

  const state = useMemo(
    () => (servers ? { servers, signedIn, forget } : null),
    [servers, signedIn, forget],
  );

  if (!state) return null;
  return <ServersContext.Provider value={state}>{children}</ServersContext.Provider>;
}
