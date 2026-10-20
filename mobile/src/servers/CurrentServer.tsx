import { createContext, type ReactNode, useContext } from "react";
import type { SavedServer } from "../api/servers";

// The server a /s/<id> screen is on, handed down by its layout. A tab
// reached by pressing it gets none of the layout's route params, so the
// tabs read the server from here rather than from the route.
const CurrentServerContext = createContext<SavedServer | null>(null);

export function CurrentServer({ server, children }: { server: SavedServer; children: ReactNode }) {
  return <CurrentServerContext.Provider value={server}>{children}</CurrentServerContext.Provider>;
}

export function useCurrentServer(): SavedServer {
  const server = useContext(CurrentServerContext);
  if (!server) throw new Error("useCurrentServer needs a CurrentServer above it");
  return server;
}
