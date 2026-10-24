// Every request the app makes goes through here. React Native's fetch
// keeps cookies by default, and the server sets its browser session
// cookie on sign-in: kept, that would be a second copy of the session in
// the app's cookie store, outside the keychain and backed up with the
// phone. The app's only credential is the bearer token (api/servers.ts),
// so no request stores or sends a cookie.
export function fetchWithoutCookies(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, { ...init, credentials: "omit" });
}

// A multipart upload with a file part, the one request fetch can't make
// here: React Native's FormData takes a file as its local uri, which its
// networking streams from disk, but the global fetch is Expo's, which
// refuses such a part (expo/fetch convertFormData) and would otherwise
// need the whole file read into memory first. So XMLHttpRequest, still
// React Native's networking, with credentials off: on both platforms no
// cookie is sent or kept (HTTPShouldHandleCookies off on iOS, a cookie
// jar that holds none on Android). Answers the status and the body.
export function uploadWithoutCookies(
  url: string,
  form: FormData,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.withCredentials = false;
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.onload = () => resolve({ status: request.status, body: request.responseText });
    request.onerror = () => reject(new Error("Network request failed"));
    request.send(form);
  });
}
