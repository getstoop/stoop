import { useContext } from "react";
import type { SavedServer } from "../api/servers";
import ServersProvider, { ServersContext } from "./ServersProvider";

export { ServersProvider };
export type { SavedServer };

export function useServers() {
  const state = useContext(ServersContext);
  if (!state) throw new Error("useServers needs a ServersProvider above it");
  return state;
}

// One saved server by its local ID, or undefined.
export function useServer(id: string | undefined): SavedServer | undefined {
  return useServers().servers.find((s) => s.id === id);
}
