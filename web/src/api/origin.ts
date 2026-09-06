// The server this app talks to. Same-origin: the Go binary serves the
// app and the API together, and in dev Vite proxies. Every URL the app
// builds for the server goes through here, so a client hosted somewhere
// else would change this file and nothing else.

export function serverOrigin(): string {
  return location.origin;
}

// An absolute http(s) URL for a server path.
export function serverUrl(path: string): string {
  return new URL(path, serverOrigin()).toString();
}

// The same for a WebSocket path: ws: under http:, wss: under https:.
export function socketUrl(path: string): string {
  const url = new URL(path, serverOrigin());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
