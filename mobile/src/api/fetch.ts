// Every request the app makes goes through here. React Native's fetch
// keeps cookies by default, and the server sets its browser session
// cookie on sign-in: kept, that would be a second copy of the session in
// the app's cookie store, outside the keychain and backed up with the
// phone. The app's only credential is the bearer token (api/servers.ts),
// so no request stores or sends a cookie.
export function fetchWithoutCookies(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, { ...init, credentials: "omit" });
}
