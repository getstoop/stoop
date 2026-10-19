import { ConnectError } from "@connectrpc/connect";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { authClient } from "./clients";
import { loginErrorText } from "./loginErrors";
import { hostOf } from "./probe";

// The three ways this app gets a session: a password, a new account, and
// a login provider in the system browser. Each ends with a bearer token
// for the server to keep (api/servers.ts).

export class SignInError extends Error {}

// The server's own words for a refusal, and the runtime's for anything
// else, as web's errorText.
export function signInErrorText(err: unknown): string {
  if (err instanceof ConnectError) return err.rawMessage;
  return err instanceof Error ? err.message : String(err);
}

export async function signInWithPassword(
  origin: string,
  username: string,
  password: string,
): Promise<string> {
  const res = await authClient(origin).login({ username, password });
  if (!res.token) throw new SignInError("The server didn't hand back a session.");
  return res.token;
}

// Register answers with a cookie but no token, so the new account signs
// in straight after, as web's login card does.
export async function createAccount(
  origin: string,
  username: string,
  password: string,
): Promise<string> {
  await authClient(origin).register({ username, password });
  return signInWithPassword(origin, username, password);
}

export type ProviderResult = { kind: "signedIn"; token: string } | { kind: "cancelled" };

// Provider sign-in, by the desktop app's hand-off (identity.md → Sign-in
// from the desktop app): open an attempt with a PKCE challenge, run the
// provider in the system browser's auth session, and redeem the code the
// stoop://auth link carries back with the verifier only this app holds.
// Throws a SignInError with words for the person when it fails.
export async function signInWithProvider(
  origin: string,
  provider: string,
): Promise<ProviderResult> {
  const verifier = base64url(Crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64urlFromBase64(
    await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
      encoding: Crypto.CryptoEncoding.BASE64,
    }),
  );

  const start = await postJSON(origin, "/auth/desktop/start", {
    provider,
    attemptChallenge: challenge,
    attemptMethod: "S256",
  });
  if (!start.ok || typeof start.body.attempt !== "string") {
    throw new SignInError(
      start.body.error ? loginErrorText(start.body.error) : "Sign-in couldn't be started.",
    );
  }

  const url = `${origin}/auth/oidc/${encodeURIComponent(provider)}/start?attempt=${encodeURIComponent(start.body.attempt)}`;
  const session = await WebBrowser.openAuthSessionAsync(url, "stoop://");
  if (session.type !== "success") return { kind: "cancelled" };

  const code = codeFromHandBack(origin, session.url);
  const done = await postJSON(origin, "/auth/desktop/complete", {
    code,
    attemptVerifier: verifier,
  });
  if (!done.ok || typeof done.body.token !== "string" || !done.body.token) {
    throw new SignInError("That sign-in link has expired. Try signing in again.");
  }
  return { kind: "signedIn", token: done.body.token };
}

// The return page fires stoop://auth?server=…&code=… on success, and
// stoop://open?server=…&path=/login?error=… on a refusal. The server is
// named by its public URL, which has to be the address added here: a
// server added by another name hands back to one this app hasn't heard of.
function codeFromHandBack(origin: string, link: string): string {
  const { hostname, queryParams } = Linking.parse(link);
  const param = (key: string) => {
    const v = queryParams?.[key];
    return typeof v === "string" ? v : "";
  };
  const server = param("server");
  if (server && server !== origin) {
    throw new SignInError(
      `The server signed you in as ${hostOf(server)}, not ${hostOf(origin)}. Add it by that address instead.`,
    );
  }
  if (hostname === "auth" && param("code")) return param("code");
  const error = /[?&]error=([^&]*)/.exec(param("path"))?.[1];
  throw new SignInError(loginErrorText(error ? decodeURIComponent(error) : ""));
}

type JSONBody = { attempt?: unknown; token?: unknown; error?: string };

async function postJSON(
  origin: string,
  path: string,
  body: unknown,
): Promise<{ ok: boolean; body: JSONBody }> {
  let res: Response;
  try {
    res = await fetch(`${origin}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new SignInError(`Couldn't reach ${hostOf(origin)}.`);
  }
  const parsed = (await res.json().catch(() => ({}))) as JSONBody;
  return { ok: res.ok, body: parsed };
}

function base64url(bytes: Uint8Array): string {
  return base64urlFromBase64(btoa(String.fromCharCode(...bytes)));
}

function base64urlFromBase64(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
