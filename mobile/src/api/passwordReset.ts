import { PasswordSignIn } from "@stoop/gen/stoop/instance/v1/instance_pb";

// The rules for offering a password reset, as web's
// (web/src/api/passwordReset.ts), so both clients offer it on the same
// servers and refuse the same addresses.

// Whether this server can reset a password by email at all: it can send
// links, and password sign-in isn't off (then nobody's password is reset,
// admins included).
export function resetOffered(resetAvailable: boolean, passwordSignIn: PasswordSignIn): boolean {
  return resetAvailable && passwordSignIn !== PasswordSignIn.OFF;
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
