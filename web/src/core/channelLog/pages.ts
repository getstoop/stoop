import type { ListMessagesResponse } from "../../gen/stoop/chat/v1/chat_pb";
import { withFloor } from "./floor";
import { pruned } from "./prune";
import { isShown, mergeRows } from "./rows";
import { type ChannelLog, emptyView, type View } from "./types";
import { belongs, inRange, viewOf, withView } from "./views";

// A ListMessages page for a view: the channel's (no rootId) or a
// thread's. The answer carries the view's generation when it was asked
// for; one under a stale generation is dropped.
export type PageAnswer = {
  rootId?: string;
  generation: number;
  res: ListMessagesResponse;
};

// A new range for the view: the page's rows, edge to edge. The first page
// a log sees sets its seq; later pages never move it, a page not being a
// complete picture of the changes. The generation moves, so a page still
// out for the old range is dropped when it answers.
export function opened(log: ChannelLog, answer: PageAnswer): ChannelLog {
  const view = viewOf(log, answer.rootId) ?? emptyView;
  if (view.generation !== answer.generation) return log;
  const { res } = answer;
  const rows = res.messages;
  const replaced: View = {
    oldestId: rows[0]?.id ?? null,
    newestId: rows[rows.length - 1]?.id ?? null,
    hasOlder: res.hasOlder,
    hasNewer: res.hasNewer,
    pendingNewer: 0,
    generation: view.generation + 1,
  };
  const next = withView(
    {
      ...log,
      rows: mergeRows(log.rows, rows, false),
      seq: log.seq === 0 ? Number(res.channelSeq) : log.seq,
    },
    answer.rootId,
    replaced,
  );
  return stretched(withFloor(next, res.retentionFloorId), answer.rootId);
}

// A page around a message replaces the range the same way.
export const jumped = opened;

// The page beyond one end of the range: the range grows over it, the
// edge's flag is the page's, and past the cap the far end is pruned.
export function paged(
  log: ChannelLog,
  direction: "older" | "newer",
  answer: PageAnswer,
): ChannelLog {
  const view = viewOf(log, answer.rootId);
  if (!view || view.generation !== answer.generation) return log;
  const { res } = answer;
  const rows = res.messages;
  const first = rows[0]?.id;
  const last = rows[rows.length - 1]?.id;
  const grown: View =
    direction === "older"
      ? {
          ...view,
          oldestId: lower(view.oldestId, first),
          hasOlder: res.hasOlder,
        }
      : {
          ...view,
          newestId: higher(view.newestId, last),
          hasNewer: res.hasNewer,
          // Back at the newest row: everything counted is now shown.
          pendingNewer: res.hasNewer ? view.pendingNewer : 0,
        };
  let next = withView(
    { ...log, rows: mergeRows(log.rows, rows, false) },
    answer.rootId,
    grown,
  );
  next = stretched(withFloor(next, res.retentionFloorId), answer.rootId);
  return pruned(
    next,
    answer.rootId,
    direction === "older" ? "newest" : "oldest",
  );
}

// Rows held beyond an edge nothing lies beyond on the server (arrived by
// an event while the page was out) are inside the range after all.
function stretched(log: ChannelLog, rootId: string | undefined): ChannelLog {
  const view = viewOf(log, rootId);
  if (!view || (view.hasNewer && view.hasOlder)) return log;
  let { oldestId, newestId } = view;
  for (const row of log.rows.values()) {
    if (!belongs(row, rootId) || !isShown(row) || inRange(view, row.id))
      continue;
    if (!view.hasNewer && (newestId === null || row.id > newestId))
      newestId = row.id;
    if (!view.hasOlder && (oldestId === null || row.id < oldestId))
      oldestId = row.id;
  }
  if (oldestId === view.oldestId && newestId === view.newestId) return log;
  return withView(log, rootId, { ...view, oldestId, newestId });
}

const lower = (held: string | null, id: string | undefined) =>
  id === undefined ? held : held === null || id < held ? id : held;
const higher = (held: string | null, id: string | undefined) =>
  id === undefined ? held : held === null || id > held ? id : held;
