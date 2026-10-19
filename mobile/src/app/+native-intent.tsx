// Links into the app, rewritten before the router sees them. stoop://auth
// and stoop://open are the provider sign-in hand-back, which the browser's
// auth session catches and api/signIn.ts reads; they are not places to go,
// so the app stays where it is.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | null {
  if (/^stoop:\/\/(auth|open)\b/.test(path)) return null;
  return path;
}
