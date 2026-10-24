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
// Settles once on every ending, so a caller holding an upload slot
// always gets it back: an answer, a network failure, the platform's
// timeout (iOS ends a silent request after about a minute; Android never
// does, which the server's own 30 s idle limit covers), or the signal
// aborting it, which rejects with an AbortError.
export function uploadWithoutCookies(
  url: string,
  form: FormData,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(aborted());
      return;
    }
    const request = new XMLHttpRequest();
    let settled = false;
    const abort = () => request.abort();
    const settle = (end: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      end();
    };
    request.onload = () => settle(() => resolve({ status: request.status, body: request.responseText }));
    request.onerror = () => settle(() => reject(new Error("Network request failed")));
    request.ontimeout = () => settle(() => reject(new Error("The upload timed out")));
    request.onabort = () => settle(() => reject(aborted()));
    signal?.addEventListener("abort", abort);
    request.open("POST", url);
    request.withCredentials = false;
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.send(form);
  });
}

const aborted = () => Object.assign(new Error("The upload was stopped"), { name: "AbortError" });
