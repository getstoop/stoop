import { Code, ConnectError } from "@connectrpc/connect";
import { PasswordSignIn } from "../gen/stoop/instance/v1/instance_pb";

// Whether the login page shows its password form. Restricted or off, it
// hides unless asked for (?password=1, the admins' fallback), and never
// when there is no provider to fall back to.
export function passwordFormShown(
  passwordSignIn: PasswordSignIn,
  forcePassword: boolean,
  providerCount: number,
): boolean {
  return (
    passwordSignIn === PasswordSignIn.EVERYONE ||
    forcePassword ||
    providerCount === 0
  );
}

// Whether this server can reset a password by email at all: it can send
// links, and password sign-in isn't off (then nobody's password is reset,
// admins included).
export function resetOffered(
  resetAvailable: boolean,
  passwordSignIn: PasswordSignIn,
): boolean {
  return resetAvailable && passwordSignIn !== PasswordSignIn.OFF;
}

// "Forgot password?" sits beside the password of a sign-in form, and only
// when a reset can be offered.
export function forgotLinkShown(
  offered: boolean,
  formShown: boolean,
  mode: "login" | "register",
): boolean {
  return offered && formShown && mode === "login";
}

// The server's own words for an address it would refuse, checked before
// sending.
export function emailAddressError(raw: string): string | null {
  const address = raw.trim();
  if (address === "") return "Enter an email address.";
  const at = address.indexOf("@");
  const oneAddress =
    at > 0 &&
    at === address.lastIndexOf("@") &&
    at < address.length - 1 &&
    !/[\s,;<>]/.test(address);
  return oneAddress ? null : "Enter one email address, like casey@example.com.";
}

export const PASSWORDS_DIFFER = "The two new passwords don't match.";

export function confirmPasswordError(
  newPassword: string,
  confirm: string,
): string | null {
  return newPassword === confirm ? null : PASSWORDS_DIFFER;
}

// A reset link the server no longer honours, as opposed to a server or
// network failure.
export function isSpentLink(err: unknown): boolean {
  return (
    err instanceof ConnectError &&
    (err.code === Code.FailedPrecondition || err.code === Code.NotFound)
  );
}
