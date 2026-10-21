import { withoutRows } from "./rows";
import { type ChannelLog, LOG_CAP } from "./types";
import {
  belongs,
  inRange,
  referenced,
  shownRows,
  viewOf,
  withView,
} from "./views";

// A view holds at most LOG_CAP shown rows. Past that, the end away from
// the reader goes: paging older drops the newest rows and the view stops
// being live (the pill brings the reader back); paging newer, or rows
// arriving live, drops the oldest. A row dropped from a view leaves the
// map unless another view still lists it, so memory stays bounded.
export function pruned(
  log: ChannelLog,
  rootId: string | undefined,
  drop: "oldest" | "newest",
): ChannelLog {
  const view = viewOf(log, rootId);
  if (!view) return log;
  const shown = shownRows(log, rootId);
  if (shown.length <= LOG_CAP) return log;
  const ids = shown.map((row) => row.id).sort();
  const kept =
    drop === "newest" ? ids.slice(0, LOG_CAP) : ids.slice(ids.length - LOG_CAP);
  const narrowed =
    drop === "newest"
      ? { ...view, newestId: kept[kept.length - 1], hasNewer: true }
      : { ...view, oldestId: kept[0], hasOlder: true };
  const next = withView(log, rootId, narrowed);
  const gone: string[] = [];
  for (const row of log.rows.values()) {
    if (
      belongs(row, rootId) &&
      inRange(view, row.id) &&
      !inRange(narrowed, row.id) &&
      !referenced(next, row)
    )
      gone.push(row.id);
  }
  return { ...next, rows: withoutRows(next.rows, gone) };
}
