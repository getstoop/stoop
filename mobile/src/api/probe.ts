import { instanceClient } from "./clients";
import { fetchWithoutCookies } from "./fetch";

// Asking a typed address whether it is a Stoop server the app can use,
// before anyone signs in. The rules follow the desktop app's probe, so
// both clients accept and refuse the same addresses:
// docs/architecture/desktop.md → GET /version.

// The oldest server this app works with. "dev" and anything else without
// a version number passes: a build without a stamp is newer than any
// release.
export const MIN_SERVER_VERSION = "0.12.0";

const TIMEOUT_MS = 6000;

export type Probe =
  | { kind: "found"; origin: string; name: string; version: string }
  | { kind: "too-old"; origin: string; name: string; version: string }
  | { kind: "not-stoop"; detail: string }
  | { kind: "unreachable"; detail: string };

// Turns whatever was typed into an origin: adds https:// when no scheme
// was given, drops any path. Returns null when it is not a URL at all.
export function normalizeServerUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const withScheme = /^[a-z]+:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

// The address as people say it: the host, without the scheme.
export function hostOf(origin: string): string {
  return new URL(origin).host;
}

// GET /version says whether the server is Stoop and which version; the
// instance status gives its name. Aborting `signal` (the address changed)
// stops both.
export async function probeServer(origin: string, signal: AbortSignal): Promise<Probe> {
  const host = hostOf(origin);
  const timeout = withTimeout(signal);
  let res: Response;
  try {
    res = await fetchWithoutCookies(`${origin}/version`, {
      signal: timeout.signal,
      headers: { accept: "application/json" },
    });
  } catch {
    return {
      kind: "unreachable",
      detail: timeout.timedOut()
        ? `No answer from ${host} within six seconds.`
        : `Couldn't reach ${host}. Check the address, and that this phone is on a network that can reach the server.`,
    };
  } finally {
    timeout.clear();
  }

  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.includes("application/json")) {
    const status = `${res.status} ${res.statusText}`.trim();
    return {
      kind: "not-stoop",
      detail: res.ok
        ? `${host} answered, but not the way a Stoop server does.`
        : `${host} answered with ${status}.`,
    };
  }
  let body: { name?: unknown; version?: unknown };
  try {
    body = await res.json();
  } catch {
    return { kind: "not-stoop", detail: `${host} answered, but not the way a Stoop server does.` };
  }
  if (body.name !== "stoop" || typeof body.version !== "string") {
    return { kind: "not-stoop", detail: `${host} answered, but not the way a Stoop server does.` };
  }

  const version = body.version;
  const name = await instanceName(origin, signal);
  return { kind: meetsMinimum(version) ? "found" : "too-old", origin, name, version };
}

// The instance's name, from the RPC the sign-in page uses. Falls back to
// the host when anything goes wrong; the name is cosmetic.
async function instanceName(origin: string, signal: AbortSignal): Promise<string> {
  try {
    const status = await instanceClient(origin).getInstanceStatus(
      {},
      { signal, timeoutMs: TIMEOUT_MS },
    );
    if (status.instanceName) return status.instanceName;
  } catch {
    // fall through
  }
  return hostOf(origin);
}

// True when the server is at least the minimum. "dev" and anything
// unparseable pass.
export function meetsMinimum(version: string): boolean {
  const got = parse(version);
  const min = parse(MIN_SERVER_VERSION);
  if (!got || !min) return true;
  for (let i = 0; i < 3; i++) {
    if (got[i] !== min[i]) return got[i] > min[i];
  }
  return true;
}

function parse(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// A signal that aborts when `outer` does or after TIMEOUT_MS, and says
// which. Written out because AbortSignal.timeout and AbortSignal.any are
// not in every React Native runtime.
function withTimeout(outer: AbortSignal) {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT_MS);
  outer.addEventListener("abort", abort);
  if (outer.aborted) abort();
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    clear: () => {
      clearTimeout(timer);
      outer.removeEventListener("abort", abort);
    },
  };
}
