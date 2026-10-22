import type { ListChangesResponse } from "../../gen/stoop/chat/v1/chat_pb";
import { withArrivals } from "./arrivals";
import { withFloor } from "./floor";
import { seqOf } from "./rows";
import type { ChannelLog } from "./types";

// A ListChanges page: every row merged by seq, a row new to the log placed
// like an event's, the floor applied. The position moves only on the last
// page (hasMore false), to the channel's seq or the highest row's; while
// paging, the caller continues from the last row's seq (nextSince) and the
// log's seq stays, so a failure midway still owes the whole catch-up.
export function caughtUp(
  log: ChannelLog,
  res: ListChangesResponse,
): ChannelLog {
  const next = withFloor(
    withArrivals(log, res.messages, false),
    res.retentionFloorId,
  );
  if (res.hasMore) return next;
  let top = Number(res.channelSeq);
  for (const row of res.messages) top = Math.max(top, seqOf(row));
  const seq = Math.max(next.seq, top);
  if (seq === next.seq && !next.needsCatchUp) return next;
  return { ...next, seq, needsCatchUp: false };
}

// The seq the next ListChanges page is asked from.
export function nextSince(since: number, res: ListChangesResponse): number {
  const last = res.messages[res.messages.length - 1];
  return last ? Math.max(since, seqOf(last)) : since;
}

// The socket is back: whatever was missed is owed. Nothing held is
// dropped; the catch-up puts it right.
export function reconnected(log: ChannelLog): ChannelLog {
  return log.needsCatchUp ? log : { ...log, needsCatchUp: true };
}
