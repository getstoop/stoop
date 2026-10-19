import * as SecureStore from "expo-secure-store";

// The servers this phone is signed in to, and each one's session token.
// Both live in the keychain (Android: the keystore): the token because it
// is a credential, the list because there is no other store yet and it is
// small. Nothing leaves this device-only class, so a backup restored to
// another phone comes back signed out rather than carrying sessions over.

export type SavedServer = {
  // A short local ID, made when the server is first saved and used in the
  // app's own URLs (/s/<id>). It never changes for that origin.
  id: string;
  origin: string;
  name: string;
};

const LIST_KEY = "servers";
const tokenKey = (id: string) => `session.${id}`;
const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

// Most recently signed in first.
export async function loadServers(): Promise<SavedServer[]> {
  const raw = await SecureStore.getItemAsync(LIST_KEY, OPTIONS);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as SavedServer[];
    return Array.isArray(list) ? list.filter((s) => s.id && s.origin) : [];
  } catch {
    return [];
  }
}

export function sessionToken(id: string): Promise<string | null> {
  return SecureStore.getItemAsync(tokenKey(id), OPTIONS);
}

// Keeps a new session for origin, under the ID the server already has
// here or a new one, and moves it to the front. Returns the new list.
export async function saveSignIn(
  servers: SavedServer[],
  origin: string,
  name: string,
  token: string,
): Promise<SavedServer[]> {
  const known = servers.find((s) => s.origin === origin);
  const server = { id: known?.id ?? newId(servers), origin, name };
  await SecureStore.setItemAsync(tokenKey(server.id), token, OPTIONS);
  const list = [server, ...servers.filter((s) => s.id !== server.id)];
  await SecureStore.setItemAsync(LIST_KEY, JSON.stringify(list), OPTIONS);
  return list;
}

// Forgets a server and its session. Returns the new list.
export async function forgetServer(servers: SavedServer[], id: string): Promise<SavedServer[]> {
  await SecureStore.deleteItemAsync(tokenKey(id), OPTIONS);
  const list = servers.filter((s) => s.id !== id);
  await SecureStore.setItemAsync(LIST_KEY, JSON.stringify(list), OPTIONS);
  return list;
}

// Six base-36 characters: short in a URL, and a clash among a handful of
// servers is checked for rather than left to chance.
function newId(servers: SavedServer[]): string {
  for (;;) {
    const id = Math.random().toString(36).slice(2, 8);
    if (id.length === 6 && !servers.some((s) => s.id === id)) return id;
  }
}
