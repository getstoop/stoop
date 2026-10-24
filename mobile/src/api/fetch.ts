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
// networking reads natively (streamed from disk on Android, built into
// one body in native memory on iOS), but the global fetch is Expo's,
// which refuses such a part (expo/fetch convertFormData) and would
// otherwise need the whole file read into JS first. So XMLHttpRequest, still
// React Native's networking, with credentials off: on both platforms no
// cookie is sent or kept (HTTPShouldHandleCookies off on iOS, a cookie
// jar that holds none on Android). Answers the status and the body.
// Settles once on every ending, so a caller holding an upload slot
// always gets it back: an answer, a network failure, the platform's
// timeout, the signal aborting it (an AbortError), or the watchdog. No
// fixed deadline, since a large file on a slow line may rightly take
// minutes; instead the request is ended once nothing has moved for
// IDLE_MS, neither bytes going up nor an answer coming back. Android
// sets no timeout of its own, and the server's 30 s idle limit only
// helps while its answer can still reach the phone.
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
    let idle: ReturnType<typeof setTimeout> | undefined;
    const abort = () => request.abort();
    const settle = (end: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(idle);
      signal?.removeEventListener("abort", abort);
      end();
    };
    const moved = () => {
      clearTimeout(idle);
      idle = setTimeout(() => {
        settle(() => reject(new Error("The upload stopped arriving; try again")));
        request.abort();
      }, IDLE_MS);
    };
    request.upload.onprogress = moved;
    request.onprogress = moved;
    request.onload = () => settle(() => resolve({ status: request.status, body: request.responseText }));
    request.onerror = () => settle(() => reject(new Error("Network request failed")));
    request.ontimeout = () => settle(() => reject(new Error("The upload timed out")));
    request.onabort = () => settle(() => reject(aborted()));
    signal?.addEventListener("abort", abort);
    request.open("POST", url);
    request.withCredentials = false;
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.send(form);
    moved();
  });
}

const IDLE_MS = 60_000;

const aborted = () => Object.assign(new Error("The upload was stopped"), { name: "AbortError" });
