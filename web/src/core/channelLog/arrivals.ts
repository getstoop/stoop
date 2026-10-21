import type { Message } from "../../gen/stoop/chat/v1/message_pb";
import { retiredMatching } from "./pending";
import { pruned } from "./prune";
import { isShown, mergeRows, seqOf } from "./rows";
import { withQuotesBlanked } from "./tombstone";
import type { ChannelLog } from "./types";
import { placed } from "./views";

// Rows arriving by something other than a page: a realtime event, a
// catch-up, or the answer to the reader's own send. Each is merged by seq;
// one new to the log takes its place in the views that list it (views.ts
// placed), and may be the server's row for a pending send. A page's rows
// set the range instead (pages.ts), so they are merged alone.
export type Source = "event" | "catchUp" | "send";

export function withArrivals(
  log: ChannelLog,
  incoming: Message[],
  source: Source,
): ChannelLog {
  // A catch-up carries the reader's own half of a thread summary; an
  // event doesn't, and a send's answer has no held copy to keep it from.
  const rows = mergeRows(log.rows, incoming, source !== "catchUp");
  if (rows === log.rows) return log;
  let next: ChannelLog = { ...log, rows };
  const threads = new Set<string>();
  for (const row of incoming) {
    // A copy at or below the held seq changed nothing.
    const kept = rows.get(row.id);
    if (!kept || seqOf(kept) > seqOf(row)) continue;
    if (kept.deleted)
      next = { ...next, rows: withQuotesBlanked(next.rows, row.id) };
    if (log.rows.has(row.id)) continue;
    // A send's answer retires its draft by id (sends.ts), never by
    // likeness: a twin draft would go in its place.
    if (source !== "send") next = retiredMatching(next, row);
    if (!isShown(row)) continue;
    next = placed(next, row);
    if (row.threadRootId) threads.add(row.threadRootId);
  }
  next = pruned(next, undefined, "oldest");
  for (const rootId of threads) next = pruned(next, rootId, "oldest");
  return next;
}
