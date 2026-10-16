// The server the app talks to. Expo inlines EXPO_PUBLIC_ variables into
// the bundle when Metro builds it, from mobile/.env.local. On a phone,
// localhost is the phone, so this is the Mac's LAN address.
export function serverUrl(): string {
  const url = process.env.EXPO_PUBLIC_STOOP_URL;
  if (!url) {
    throw new Error(
      "EXPO_PUBLIC_STOOP_URL is not set: add it to mobile/.env.local and restart Metro",
    );
  }
  return url.replace(/\/+$/, "");
}

// What GET /version answers (internal/app/version.go). It is plain JSON,
// not a Connect RPC: a client reads it before anyone signs in.
export type ServerVersion = {
  name: string;
  version: string;
  bridge: number;
};

export async function fetchVersion(): Promise<ServerVersion> {
  const response = await fetch(`${serverUrl()}/version`);
  if (!response.ok) {
    throw new Error(`GET /version answered ${response.status}`);
  }
  return (await response.json()) as ServerVersion;
}
