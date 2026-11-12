import * as SecureStore from "expo-secure-store";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { parseLastSpaces } from "./lastSpaces";
import { type LastSpaceStore, lastSpaceStore } from "./store";

// The space each server's Spaces tab last showed (lastSpaces.ts), at
// the root of the app so the saved map is read as the app starts, well
// before a server's spaces can have loaded. Kept in the keychain beside
// the theme and do not disturb: the phone's own, never sent to a server.

const KEY = "last-spaces";

const LastSpaceContext = createContext<LastSpaceStore | null>(null);

export default function LastSpaceProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() =>
    lastSpaceStore(
      // A failed save only means the next launch opens on the space before.
      (next) => void SecureStore.setItemAsync(KEY, JSON.stringify(next)).catch(() => {}),
    ),
  );

  // A read the keychain refuses is an empty map: every server opens on
  // its first space.
  useEffect(() => {
    SecureStore.getItemAsync(KEY)
      .catch(() => null)
      .then((raw) => store.loaded(parseLastSpaces(raw)));
  }, [store]);

  return <LastSpaceContext.Provider value={store}>{children}</LastSpaceContext.Provider>;
}

export function useLastSpaceStore(): LastSpaceStore {
  const store = useContext(LastSpaceContext);
  if (!store) throw new Error("The last space needs a LastSpaceProvider above it");
  return store;
}

// Drops a removed server's space.
export function useForgetServerSpace(): (serverId: string) => void {
  return useLastSpaceStore().forgetServer;
}
