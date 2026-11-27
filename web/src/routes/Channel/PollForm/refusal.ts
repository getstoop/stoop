import { Code, ConnectError } from "@connectrpc/connect";

// What a refusal of either poll form says: the server's own words for a
// rule it holds (an announcement channel, a blocked conversation, a line
// or a time it would not take), and "try again" for anything that may
// pass on a second try.
export function refusal(err: unknown): string {
  const lead = "Couldn't post the poll.";
  if (!(err instanceof ConnectError) || !SAID_BY_SERVER.has(err.code)) {
    return `${lead} Try again.`;
  }
  const said = err.rawMessage.trim();
  if (!said) return `${lead} Try again.`;
  const sentence = said[0].toUpperCase() + said.slice(1);
  return `${lead} ${sentence}${/[.!?]$/.test(sentence) ? "" : "."}`;
}

const SAID_BY_SERVER = new Set([
  Code.InvalidArgument,
  Code.PermissionDenied,
  Code.FailedPrecondition,
  Code.NotFound,
]);
