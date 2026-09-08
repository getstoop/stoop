// Provider sign-in and account linking from the desktop shell. The
// provider leg runs in the system browser — an embedded view is refused
// by some providers — and comes back as a stoop://auth deep link the
// shell loads in this same view, so the verifier below survives the
// navigation.
// docs/architecture/identity.md → Provider sign-in.

import { linkErrorText } from "./loginErrors";
import { serverUrl } from "./origin";

// The attempt waits here between opening the browser and the hand-back.
// Session storage, not local: it belongs to this window and this attempt.
const ATTEMPT_KEY = "stoop.desktopAttempt";

interface SavedAttempt {
  verifier: string;
  // Where the sign-in was headed, e.g. the invite the person followed.
  redirect?: string;
  // A link attempt, not a sign-in: it mints no session and ends on the
  // profile page.
  link?: boolean;
}

// What redeeming a code turned out to be. A sign-in is finished; a link
// stops here until the person recognises the identity that came back.
export type DesktopAuthResult =
  | { kind: "signedIn"; redirect?: string }
  | { kind: "confirmLink"; provider: string; email: string };

interface CompleteBody {
  linked?: string;
  provider?: string;
  email?: string;
  error?: string;
}

const COMPLETE_PATH = "/auth/desktop/complete";

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// The shell↔server PKCE pair, unrelated to the server↔provider one.
// crypto.subtle is withheld from a plain-HTTP origin, which a LAN or
// tailnet server may well be; there the challenge is the verifier
// itself, and the server is told so.
async function pkce(): Promise<{
  verifier: string;
  challenge: string;
  method: "S256" | "plain";
}> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  if (!crypto.subtle) return { verifier, challenge: verifier, method: "plain" };
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return {
    verifier,
    challenge: base64url(new Uint8Array(digest)),
    method: "S256",
  };
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(serverUrl(path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Opens an attempt and returns the absolute provider start URL to hand
// the system browser. Throws when the server won't start one. A link
// attempt is authenticated: this fetch is same-origin, so it carries the
// session the identity will attach to.
export async function beginDesktopAuth(
  provider: string,
  startURL: string,
  opts: { link?: boolean } = {},
): Promise<string> {
  const { verifier, challenge, method } = await pkce();
  const what = opts.link ? "linking" : "sign-in";
  const res = await post("/auth/desktop/start", {
    provider,
    attemptChallenge: challenge,
    attemptMethod: method,
    link: opts.link === true,
  });
  if (!res.ok) throw new Error(`${what} could not be started (${res.status})`);
  const { attempt } = (await res.json()) as { attempt?: string };
  if (!attempt) throw new Error(`${what} could not be started`);
  const url = new URL(serverUrl(startURL));
  const saved: SavedAttempt = {
    verifier,
    redirect: url.searchParams.get("redirect") ?? undefined,
    link: opts.link === true,
  };
  sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(saved));
  url.searchParams.set("attempt", attempt);
  return url.toString();
}

// The deep links the return page fires, built from this page's own
// origin: the provider round trip lands on the server's public address,
// so that is the origin the shell has to be told about.
export function authLinkForCode(code: string): string {
  return `stoop://auth?${new URLSearchParams({
    server: location.origin,
    code,
  })}`;
}

// A link's failures land on the profile page, where the person started;
// a sign-in's on the login card.
export function errorLinkForCode(error: string, link = false): string {
  return `stoop://open?${new URLSearchParams({
    server: location.origin,
    path: `${link ? "/profile" : "/login"}?error=${error}`,
  })}`;
}

// Redeems the code the shell carried back, in the view that opened the
// attempt. A sign-in's session cookie lands here and it is done. A link
// gets the identity the round trip found and attaches nothing: the code
// stays live for confirmDesktopLink, inside its minute.
export async function completeDesktopAuth(
  code: string,
): Promise<DesktopAuthResult> {
  const saved = readAttempt();
  if (!saved) {
    throw new Error(
      "This window didn't start that sign-in. Try signing in again.",
    );
  }
  // A link needs the verifier once more to confirm; a sign-in is done
  // with it here.
  if (!saved.link) sessionStorage.removeItem(ATTEMPT_KEY);
  const body = await complete(saved, code, false);
  if (!saved.link) return { kind: "signedIn", redirect: saved.redirect };
  return {
    kind: "confirmLink",
    provider: body.provider ?? "",
    email: body.email ?? "",
  };
}

// Attaches the identity the preview named, and spends the attempt.
export async function confirmDesktopLink(code: string): Promise<string> {
  const saved = takeAttempt();
  if (!saved) {
    throw new Error(
      "This window didn't start that request. Try connecting again.",
    );
  }
  return (await complete(saved, code, true)).linked ?? "";
}

// Throws away an attempt the person declined, so the code it belongs to
// cannot be confirmed from this window at all.
export function discardAttempt() {
  sessionStorage.removeItem(ATTEMPT_KEY);
}

async function complete(
  saved: SavedAttempt,
  code: string,
  confirm: boolean,
): Promise<CompleteBody> {
  const res = await post(COMPLETE_PATH, {
    code,
    attemptVerifier: saved.verifier,
    confirm,
  });
  const body = (await res.json().catch(() => ({}))) as CompleteBody;
  if (!res.ok) {
    // Whatever the reason, this attempt is finished: start again.
    sessionStorage.removeItem(ATTEMPT_KEY);
    // code_invalid is a code that no longer redeems; anything else is the
    // server saying why it refused the link.
    if (saved.link && body.error && body.error !== "code_invalid") {
      throw new Error(linkErrorText(body.error));
    }
    throw new Error(
      saved.link
        ? "That linking request has expired. Try connecting again."
        : "That sign-in link has expired. Try signing in again.",
    );
  }
  return body;
}

// Whether the attempt this window is waiting on is a link, for the
// completion page's wording. Peeks; takeAttempt spends it.
export function pendingIsLink(): boolean {
  return readAttempt()?.link === true;
}

function takeAttempt(): SavedAttempt | null {
  const saved = readAttempt();
  sessionStorage.removeItem(ATTEMPT_KEY);
  return saved;
}

function readAttempt(): SavedAttempt | null {
  const raw = sessionStorage.getItem(ATTEMPT_KEY);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as SavedAttempt;
    return saved.verifier ? saved : null;
  } catch {
    return null;
  }
}
