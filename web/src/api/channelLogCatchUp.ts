import { caughtUp, nextSince } from "../core/channelLog";
import { useConnectionStore } from "../stores/connection";
import { logOf, updateLog } from "./channelLogStore";
import { chatClient } from "./clients";

// A channel's catch-up: ListChanges from the log's seq, page after page
// while the server has more, each fed to the log. One runs per channel at
// a time; callers meanwhile share it. A failure leaves needsCatchUp set
// and tries again with a growing wait, as long as the socket is open:
// once it isn't, Ready's reconnected() asks again.

// The server's largest page.
const CATCH_UP_PAGE = 200;
const RETRY_BASE_MS = 1000;
const RETRY_CAP_MS = 15_000;

const running = new Map<string, Promise<void>>();

export function catchUp(channelId: string): Promise<void> {
  const shared = running.get(channelId);
  if (shared) return shared;
  const run = catchUpUntilDone(channelId).finally(() =>
    running.delete(channelId),
  );
  running.set(channelId, run);
  return run;
}

async function catchUpUntilDone(channelId: string) {
  let delay = RETRY_BASE_MS;
  for (;;) {
    const log = logOf(channelId);
    // Nothing owed, or no page yet: the first page's seq is the start.
    if (!log?.needsCatchUp || log.seq === 0) return;
    try {
      await catchUpPages(channelId, log.seq);
      return;
    } catch {
      if (useConnectionStore.getState().status !== "connected") return;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, RETRY_CAP_MS);
    }
  }
}

async function catchUpPages(channelId: string, from: number) {
  let since = from;
  for (;;) {
    const res = await chatClient.listChanges({
      channelId,
      sinceSeq: BigInt(since),
      limit: CATCH_UP_PAGE,
    });
    const after = updateLog(channelId, (log) => caughtUp(log, res));
    if (!after || !res.hasMore) return;
    since = nextSince(since, res);
  }
}
