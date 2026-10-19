// Provider sign-in and account linking from the desktop shell. The
// provider leg runs in the system browser — an embedded view is refused
// by some providers — and comes back as a stoop://auth deep link the
// shell loads in this same view, so the verifier below survives the
// navigation.
// docs/architecture/identity.md → Provider sign-in.

import { CONFIRM_FAILED, linkErrorText } from "./loginErrors";
import { serverUrl } from "./origin";

// The attempt waits here between opening the browser and the hand-back.
// Session storage, not local: it belongs to this window and this attempt.
const ATTEMPT_KEY = "stoop.desktopAttempt";

interface SavedAttempt {
  verifier: string;
  // A link attempt, not a sign-in: it mints no session and ends on the
  // profile page.
  link?: boolean;
  // A reauth attempt ("confirm it's you"): it replaces this view's
  // session, then goes back to next.
  reauth?: boolean;
  next?: string;
}

// Which round trip an attempt is, for where its failures land and how a
// page words it.
export type AttemptKind = "signIn" | "link" | "reauth";

// What redeeming a code turned out to be. A sign-in or a reauth is
// finished; a link stops here until the person recognises the identity
// that came back.
export type DesktopAuthResult =
  | { kind: "signedIn"; target?: string }
  | { kind: "reauthed"; next?: string }
  | { kind: "confirmLink"; provider: string; email: string };

interface CompleteBody {
  // Where to land, as the server decided it — the same target the browser
  // flow obeys, so the two end in the same place.
  target?: string;
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
  opts: { link?: boolean; reauth?: boolean; next?: string } = {},
): Promise<string> {
  const { verifier, challenge, method } = await pkce();
  const what = opts.link ? "linking" : opts.reauth ? "confirming" : "sign-in";
  const res = await post("/auth/desktop/start", {
    provider,
    attemptChallenge: challenge,
    attemptMethod: method,
    link: opts.link === true,
    reauth: opts.reauth === true,
  });
  if (!res.ok) {
    // A refusal the person can act on (a link that needs a fresh
    // sign-in) is said in words; anything else by its status.
    const { error } = (await res.json().catch(() => ({}))) as {
      error?: string;
    };
    if (opts.link && error === "sign_in_again") {
      throw new Error(linkErrorText(error));
    }
    throw new Error(`${what} could not be started (${res.status})`);
  }
  const { attempt } = (await res.json()) as { attempt?: string };
  if (!attempt) throw new Error(`${what} could not be started`);
  const url = new URL(serverUrl(startURL));
  const saved: SavedAttempt = {
    verifier,
    link: opts.link === true,
    reauth: opts.reauth === true,
    next: opts.next,
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

// A link's failures land on the profile page and a reauth's on the
// confirm page, where the person started; a sign-in's on the login card.
export function errorLinkForCode(error: string, kind: AttemptKind): string {
  const page = { signIn: "/login", link: "/profile", reauth: "/confirm" }[kind];
  return `stoop://open?${new URLSearchParams({
    server: location.origin,
    path: `${page}?error=${error}`,
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
  // A link needs the verifier once more to confirm; a sign-in or a
  // reauth is done with it here.
  if (!saved.link) sessionStorage.removeItem(ATTEMPT_KEY);
  const body = await complete(saved, code, false);
  if (saved.reauth) return { kind: "reauthed", next: saved.next };
  if (!saved.link) return { kind: "signedIn", target: body.target };
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
    // A reauth says only that it didn't work (identity.md → Confirm it's
    // you).
    if (saved.reauth) throw new Error(CONFIRM_FAILED);
    throw new Error(
      saved.link
        ? "That linking request has expired. Try connecting again."
        : "That sign-in link has expired. Try signing in again.",
    );
  }
  return body;
}

// Which kind of attempt this window is waiting on, for the completion
// page's wording. Peeks; takeAttempt spends it.
export function pendingKind(): AttemptKind {
  const saved = readAttempt();
  if (saved?.link) return "link";
  if (saved?.reauth) return "reauth";
  return "signIn";
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
