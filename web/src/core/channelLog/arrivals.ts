import type { Message } from "../../gen/stoop/chat/v1/message_pb";
import { pruned } from "./prune";
import { isShown, mergeRows, type Source } from "./rows";
import { withQuotesBlanked } from "./tombstone";
import type { ChannelLog } from "./types";
import { placed } from "./views";

// Rows arriving by something other than a page: a realtime event, a
// catch-up, the answer to the reader's own request. Each is merged by seq
// (rows.ts: the source decides a tie and the reader's half of a thread
// summary), and one new to the log takes its place in the views that list
// it (views.ts placed). A page's rows set the range instead (pages.ts), so
// they are merged alone.
export function withArrivals(
  log: ChannelLog,
  incoming: Message[],
  source: Source,
): ChannelLog {
  const rows = mergeRows(log.rows, incoming, source);
  if (rows === log.rows) return log;
  let next: ChannelLog = { ...log, rows };
  const threads = new Set<string>();
  for (const row of incoming) {
    // A copy the merge did not take changed nothing.
    const kept = rows.get(row.id);
    if (!kept || kept === log.rows.get(row.id)) continue;
    if (kept.deleted)
      next = { ...next, rows: withQuotesBlanked(next.rows, row.id) };
    if (log.rows.has(row.id) || !isShown(row)) continue;
    next = placed(next, row);
    if (row.threadRootId) threads.add(row.threadRootId);
  }
  // Only a range that grew can be over the cap.
  if (next.channel !== log.channel) next = pruned(next, undefined, "oldest");
  for (const rootId of threads) {
    if (next.threads[rootId] !== log.threads[rootId])
      next = pruned(next, rootId, "oldest");
  }
  return next;
}
