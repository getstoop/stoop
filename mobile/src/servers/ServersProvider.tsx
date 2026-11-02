import { createContext, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import { clearFileCaches } from "../api/downloads";
import { forgetServer, loadServers, moveToFront, type SavedServer, saveSignIn } from "../api/servers";
import ServerListUnread from "./ServerListUnread";
import { serverList, type ServerListView } from "./serverList";

type ServersState = {
  servers: SavedServer[];
  // Keeps a new session and returns the server's local ID.
  signedIn: (origin: string, name: string, token: string) => Promise<string>;
  // Puts a server first, the one the app opens on.
  switchTo: (id: string) => Promise<void>;
  forget: (id: string) => Promise<void>;
};

export const ServersContext = createContext<ServersState | null>(null);

// Holds the saved servers for the whole app, read from the keychain at
// launch. Nothing under it renders until that read has succeeded, so a
// route's guard never mistakes "not loaded yet" for "no such server", a
// link never lands on Welcome, and nothing can start a sign-in that would
// save over a list it hasn't seen. A read that fails is tried again each
// time the app becomes active, as when the device is unlocked after the
// app launched in the background.
export default function ServersProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<ServerListView>({ state: "reading" });
  const [{ read, change }] = useState(() => serverList(loadServers, setView));

  useEffect(() => {
    read();
    const sub = AppState.addEventListener("change", (state) => state === "active" && read());
    return () => sub.remove();
  }, [read]);

  const signedIn = useCallback(
    async (origin: string, name: string, token: string) => {
      // saveSignIn puts the server it saved first.
      const list = await change((list) => saveSignIn(list, origin, name, token));
      return list[0].id;
    },
    [change],
  );

  const switchTo = useCallback(
    async (id: string) => {
      await change((list) => moveToFront(list, id));
    },
    [change],
  );

  // Forgetting a server is signing out of it, which also forgets every
  // picture and file the app has fetched (api/downloads).
  const forget = useCallback(
    async (id: string) => {
      await change((list) => forgetServer(list, id));
      await clearFileCaches();
    },
    [change],
  );

  const servers = view.state === "known" ? view.servers : null;
  const state = useMemo(
    () => (servers ? { servers, signedIn, switchTo, forget } : null),
    [servers, signedIn, switchTo, forget],
  );

  if (view.state === "unread") return <ServerListUnread onRetry={read} />;
  if (!state) return null;
  return <ServersContext.Provider value={state}>{children}</ServersContext.Provider>;
}
