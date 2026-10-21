import type { Message } from "../../gen/stoop/chat/v1/message_pb";
import { pruned } from "./prune";
import { isShown, mergeRows, seqOf } from "./rows";
import { withQuotesBlanked } from "./tombstone";
import type { ChannelLog } from "./types";
import { placed } from "./views";

// Rows arriving by something other than a page: a realtime event, or a
// catch-up. Each is merged by seq, and one new to the log takes its place
// in the views that list it (views.ts placed). A page's rows set the range
// instead (pages.ts), so they are merged alone. An event carries only the
// shared half of a thread summary, so it keeps the reader's half from the
// held copy (keepViewerHalf); a catch-up carries both and is taken whole.
export function withArrivals(
  log: ChannelLog,
  incoming: Message[],
  keepViewerHalf: boolean,
): ChannelLog {
  const rows = mergeRows(log.rows, incoming, keepViewerHalf);
  if (rows === log.rows) return log;
  let next: ChannelLog = { ...log, rows };
  const threads = new Set<string>();
  for (const row of incoming) {
    // A copy at or below the held seq changed nothing.
    const kept = rows.get(row.id);
    if (!kept || seqOf(kept) > seqOf(row)) continue;
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
