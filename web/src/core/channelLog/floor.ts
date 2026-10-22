import type { Message } from "../../gen/stoop/chat/v1/message_pb";
import { withoutRows } from "./rows";
import type { ChannelLog } from "./types";
import { withoutView } from "./views";

// Rows below the retention floor are gone from the server with no
// tombstone and no event; the floor on each answer is how a client learns.
// The sweep spares pinned roots and their whole threads, so a row below
// the floor is dropped only when it is not pinned, and a reply only when
// its root is held and not pinned: a reply whose root isn't held is kept,
// since had the root been swept the reply would not have come. The floor
// never moves back, and the rows are judged against it whichever answer
// brought them: a page asked for before a sweep answers with rows a
// catch-up since has dropped, and they go again.
export function withFloor(log: ChannelLog, floorId: string): ChannelLog {
  const floor = floorId > log.floor ? floorId : log.floor;
  if (!floor) return log;
  const gone = new Set<string>();
  for (const row of log.rows.values()) {
    if (belowFloor(log.rows, row, floor)) gone.add(row.id);
  }
  if (floor === log.floor && gone.size === 0) return log;
  let next: ChannelLog = {
    ...log,
    floor,
    rows: withoutRows(log.rows, gone),
  };
  for (const rootId of Object.keys(log.threads)) {
    if (gone.has(rootId)) next = withoutView(next, rootId);
  }
  return next;
}

function belowFloor(
  rows: ReadonlyMap<string, Message>,
  row: Message,
  floorId: string,
): boolean {
  if (row.threadRootId) {
    if (row.threadRootId >= floorId) return false;
    const root = rows.get(row.threadRootId);
    return !!root && !root.pinned;
  }
  return row.id < floorId && !row.pinned;
}
