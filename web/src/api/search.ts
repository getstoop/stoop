import { Code, ConnectError } from "@connectrpc/connect";
import { SEARCH_REFUSALS } from "../core/search";
import { errorText } from "./errors";

// Message search (docs/architecture/messaging.md): what the browser
// adds to core/search, which the phone shares.

// What to tell the person when a search fails.
export function searchErrorText(err: unknown): string {
  if (err instanceof ConnectError) {
    if (err.code === Code.ResourceExhausted) return SEARCH_REFUSALS.tooMany;
    if (err.code === Code.DeadlineExceeded) return SEARCH_REFUSALS.tooLong;
  }
  return errorText(err);
}
