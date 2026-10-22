import { Code, ConnectError } from "@connectrpc/connect";
import { caughtUp, hasPage, nextSince } from "../core/channelLog";
import { useConnectionStore } from "../stores/connection";
import { epochOf, logOf, updateLog } from "./channelLogStore";
import { chatClient } from "./clients";

// A channel's catch-up: ListChanges from the log's seq, page after page
// while the server has more, each fed to the log. One runs per channel at
// a time; callers meanwhile share it. A failure leaves needsCatchUp set
// and tries again with a growing wait, as long as the socket is open and
// the refusal is one that can pass: once the socket is down, Ready's
// reconnected() asks again; a refusal that won't change (no access, no
// such channel, signed out, a bad request) ends the loop. A run asked
// for a log since forgotten (its epoch moved) answers to nobody: a log
// re-created meanwhile holds a newer position of its own. A pass whose
// last page settles the position below an event seen meanwhile leaves the
// flag set (core/channelLog position.ts), and the next pass follows.

// The server's largest page.
const CATCH_UP_PAGE = 200;
const RETRY_BASE_MS = 1000;
const RETRY_CAP_MS = 15_000;

const FINAL = new Set([
  Code.PermissionDenied,
  Code.NotFound,
  Code.Unauthenticated,
  Code.InvalidArgument,
]);

const running = new Map<string, Promise<void>>();

export function catchUp(channelId: string): Promise<void> {
  const shared = running.get(channelId);
  if (shared) return shared;
  const run = catchUpUntilDone(channelId).finally(() => {
    if (running.get(channelId) === run) running.delete(channelId);
  });
  running.set(channelId, run);
  return run;
}

// The channel was forgotten: its run, if any, is nobody's to share.
export function forgetCatchUp(channelId: string) {
  running.delete(channelId);
}

async function catchUpUntilDone(channelId: string) {
  const epoch = epochOf(channelId);
  let delay = RETRY_BASE_MS;
  for (;;) {
    const log = logOf(channelId);
    // Nothing owed, or no page yet: the first page's seq is the start.
    if (!log?.needsCatchUp || !hasPage(log)) return;
    if (epochOf(channelId) !== epoch) return;
    try {
      await catchUpPages(channelId, log.seq, epoch);
    } catch (err) {
      if (!retryable(err)) return;
      if (useConnectionStore.getState().status !== "connected") return;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, RETRY_CAP_MS);
    }
  }
}

const retryable = (err: unknown) =>
  !(err instanceof ConnectError && FINAL.has(err.code));

async function catchUpPages(channelId: string, from: number, epoch: number) {
  let since = from;
  for (;;) {
    const res = await chatClient.listChanges({
      channelId,
      sinceSeq: BigInt(since),
      limit: CATCH_UP_PAGE,
    });
    if (epochOf(channelId) !== epoch) return;
    const after = updateLog(channelId, (log) => caughtUp(log, res));
    if (!after || !res.hasMore) return;
    since = nextSince(since, res);
  }
}
