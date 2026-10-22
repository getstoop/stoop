import type {
  ListChangesResponse,
  ListMessagesResponse,
} from "../../gen/stoop/chat/v1/chat_pb";
import { withArrivals } from "./arrivals";
import { withFloor } from "./floor";
import { positioned } from "./position";
import { FROM_PAGE, seqOf } from "./rows";
import type { ChannelLog } from "./types";

// A ListChanges page: every row merged by seq, a row new to the log placed
// like an event's, the floor applied. The position moves only on the last
// page (hasMore false), to the channel's seq or the highest row's; while
// paging, the caller continues from the last row's seq (nextSince) and the
// log's seq stays, so a failure midway still owes the whole catch-up. An
// event seen above the position it settles on (one that landed while the
// pages were out) leaves the catch-up owed, and the loader runs another.
export function caughtUp(
  log: ChannelLog,
  res: ListChangesResponse,
): ChannelLog {
  const next = withFloor(
    withArrivals(log, res.messages, FROM_PAGE),
    res.retentionFloorId,
  );
  if (res.hasMore) return next;
  let top = Number(res.channelSeq);
  for (const row of res.messages) top = Math.max(top, seqOf(row));
  return positioned(next, Math.max(next.seq, top));
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

// A view's newest page asked for again after the reconnect's catch-up:
// every row merged with the server winning a tie, so the reader's half of
// a thread summary changed elsewhere while the socket was down (a read, a
// mute: no seq moves for those, so no change comes) is taken; the floor
// applied; the range and the position left alone.
export function refreshed(
  log: ChannelLog,
  res: ListMessagesResponse,
): ChannelLog {
  return withFloor(
    withArrivals(log, res.messages, FROM_PAGE),
    res.retentionFloorId,
  );
}
