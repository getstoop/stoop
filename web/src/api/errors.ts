import { ConnectError } from "@connectrpc/connect";

// The message worth showing a person: the server's own words for a
// Connect error, and whatever the runtime said for anything else.
export function errorText(err: unknown): string {
  return err instanceof ConnectError ? err.rawMessage : String(err);
}
