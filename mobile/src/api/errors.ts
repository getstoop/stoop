import { ConnectError } from "@connectrpc/connect";

// The message worth showing a person, as web's api/errors.ts words it:
// the server's own words for a Connect error, and whatever the runtime
// said for anything else (a timeout, no network).
export function errorText(err: unknown): string {
  if (err instanceof ConnectError) return err.rawMessage;
  return err instanceof Error ? err.message : String(err);
}
