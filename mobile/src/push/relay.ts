// The push relay's one call the app makes: POST /v1/subscriptions, which
// seals this phone's APNs token and the server's key into an endpoint
// URL the server posts its pushes to. The relay keeps nothing: the URL
// carries it all, expires, and cannot be taken back, so there is no
// call to delete one (the server's DeletePushSubscription and the
// phone's keys are what end a subscription).

export type RelaySubscribe = {
  token: string; // the APNs device token, hex
  appId: string; // the bundle ID
  environment: "sandbox" | "production";
  vapidKey: string; // the server's public key, base64url
};

export type RelayEndpoint = { endpoint: string; expiresAt: number };

// What the relay answered other than an endpoint. `retryAfterMs` is its
// Retry-After when it sent one (429), and `status` is 0 when it was not
// reached at all.
export class RelayError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;

  constructor(status: number, message: string, retryAfterMs: number | null = null) {
    super(message);
    this.name = "RelayError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

const TIMEOUT_MS = 15000;

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export async function subscribeAtRelay(
  fetcher: Fetch,
  relayUrl: string,
  request: RelaySubscribe,
  now: () => number,
): Promise<RelayEndpoint> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  let response: Response;
  let text: string;
  try {
    response = await fetcher(`${relayUrl.replace(/\/+$/, "")}/v1/subscriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: "apns",
        token: request.token,
        app_id: request.appId,
        environment: request.environment,
        vapid_key: request.vapidKey,
      }),
      signal: abort.signal,
    });
    text = await response.text();
  } catch (error) {
    throw new RelayError(0, `relay not reached: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
  if (response.status !== 201) {
    const retryAfter = retryAfterMs(response.headers.get("Retry-After"), now());
    throw new RelayError(response.status, `relay answered ${response.status}`, retryAfter);
  }
  return parseEndpoint(text);
}

function parseEndpoint(text: string): RelayEndpoint {
  let body: { endpoint?: unknown; expires_at?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    throw new RelayError(201, "relay answered with no JSON");
  }
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  const expiresAt = typeof body?.expires_at === "string" ? Date.parse(body.expires_at) : Number.NaN;
  if (!endpoint.startsWith("https://") || Number.isNaN(expiresAt)) {
    throw new RelayError(201, "relay answered without an endpoint and expiry");
  }
  return { endpoint, expiresAt };
}

// Retry-After as milliseconds from now: whole seconds, or an HTTP date.
// Null when there is none or it can't be read.
export function retryAfterMs(header: string | null, now: number): number | null {
  if (!header) return null;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}
