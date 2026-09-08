// Provider sign-in from the desktop shell. The provider leg runs in the
// system browser — an embedded view is refused by some providers — and
// comes back as a stoop://auth deep link the shell loads in this same
// view, so the verifier below survives the navigation.
// docs/architecture/identity.md → Provider sign-in.

import { serverUrl } from "./origin";

// The attempt waits here between opening the browser and the hand-back.
// Session storage, not local: it belongs to this window and this attempt.
const ATTEMPT_KEY = "stoop.desktopAttempt";

interface SavedAttempt {
  verifier: string;
  // Where the sign-in was headed, e.g. the invite the person followed.
  redirect?: string;
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
// the system browser. Throws when the server won't start one.
export async function beginDesktopSignIn(
  provider: string,
  startURL: string,
): Promise<string> {
  const { verifier, challenge, method } = await pkce();
  const res = await post("/auth/desktop/start", {
    provider,
    attemptChallenge: challenge,
    attemptMethod: method,
  });
  if (!res.ok) throw new Error(`sign-in could not be started (${res.status})`);
  const { attempt } = (await res.json()) as { attempt?: string };
  if (!attempt) throw new Error("sign-in could not be started");
  const url = new URL(serverUrl(startURL));
  const saved: SavedAttempt = {
    verifier,
    redirect: url.searchParams.get("redirect") ?? undefined,
  };
  sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(saved));
  url.searchParams.set("attempt", attempt);
  return url.toString();
}

// Redeems the code the shell carried back and returns where the sign-in
// was headed. The session cookie lands in this view.
export async function completeDesktopSignIn(
  code: string,
): Promise<string | undefined> {
  const saved = takeAttempt();
  if (!saved) {
    throw new Error(
      "This window didn't start that sign-in. Try signing in again.",
    );
  }
  const res = await post(COMPLETE_PATH, {
    code,
    attemptVerifier: saved.verifier,
  });
  if (!res.ok) {
    throw new Error("That sign-in link has expired. Try signing in again.");
  }
  return saved.redirect;
}

function takeAttempt(): SavedAttempt | null {
  const raw = sessionStorage.getItem(ATTEMPT_KEY);
  sessionStorage.removeItem(ATTEMPT_KEY);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as SavedAttempt;
    return saved.verifier ? saved : null;
  } catch {
    return null;
  }
}
