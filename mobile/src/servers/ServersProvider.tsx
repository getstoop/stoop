import { createContext, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
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

  useEffect(() => {
    loadServers()
      .catch(() => [])
      .then(setServers);
  }, []);

  const signedIn = useCallback(
    async (origin: string, name: string, token: string) => {
      const list = await saveSignIn(servers ?? [], origin, name, token);
      setServers(list);
      return list[0].id;
    },
    [servers],
  );

  const forget = useCallback(
    async (id: string) => setServers(await forgetServer(servers ?? [], id)),
    [servers],
  );

  const state = useMemo(
    () => (servers ? { servers, signedIn, forget } : null),
    [servers, signedIn, forget],
  );

  if (!state) return null;
  return <ServersContext.Provider value={state}>{children}</ServersContext.Provider>;
}
