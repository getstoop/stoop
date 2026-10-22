import type { Message } from "../../gen/stoop/chat/v1/message_pb";
import type { ServerEvent } from "../../gen/stoop/realtime/v1/realtime_pb";
import { withArrivals } from "./arrivals";
import { hasPage } from "./pages";
import { FROM_EVENT, withViewerHalf } from "./rows";
import { tombstoneOf } from "./tombstone";
import type { ChannelLog } from "./types";

// What a realtime event about a message does to its channel's log. Each
// kind yields a row at the event's seq, merged by seq like any other
// arrival, and every kind moves seenSeq, the highest seq an event has
// carried. Then the position: the next seq is applied and known; one
// further on is applied too (higher wins) but marks a gap, so a catch-up
// is owed; one at or below what is known is ignored. A partial event (a
// reaction, a pin, a thread summary) about a row that isn't held covers
// nothing of its seq, so it owes a catch-up too, which brings the whole
// row. Before the first page rows are kept without judging the gap, and
// the page's channelSeq decides the position (hasPage: a channel empty
// when opened is at 0 after its page too, and events move it on from
// there), with seenSeq saying whether an event already lies above it.
export function withEvent(log: ChannelLog, event: ServerEvent): ChannelLog {
  const change = changeOf(event);
  if (!change || change.channelId !== log.channelId) return log;
  const seq = Number(change.seq);
  const positioned = hasPage(log);
  if (positioned && seq <= log.seq) return log;
  let next = change.apply(log);
  if (seq > next.seenSeq) next = { ...next, seenSeq: seq };
  if (!positioned) return next;
  const covered = !change.patches || log.rows.has(change.patches);
  if (covered && seq === log.seq + 1) return { ...next, seq };
  return next.needsCatchUp ? next : { ...next, needsCatchUp: true };
}

// The channel an event is about, or undefined for one about something
// other than a message.
export function channelOfEvent(event: ServerEvent): string | undefined {
  return changeOf(event)?.channelId;
}

type Change = {
  channelId: string;
  seq: bigint;
  // For a partial event: the row it changes, which the event covers only
  // when held.
  patches?: string;
  apply: (log: ChannelLog) => ChannelLog;
};

function changeOf(event: ServerEvent): Change | null {
  const payload = event.payload;
  switch (payload.case) {
    case "messageCreated":
    case "messageUpdated": {
      const row = payload.value;
      return {
        channelId: row.channelId,
        seq: row.seq,
        apply: (log) => withArrivals(log, [row], FROM_EVENT),
      };
    }
    case "reactionsChanged": {
      const { channelId, messageId, reactions, seq } = payload.value;
      return {
        channelId,
        seq,
        patches: messageId,
        apply: (log) =>
          patched(log, messageId, seq, (held) => ({ ...held, reactions })),
      };
    }
    case "messagePinned": {
      const { channelId, messageId, pinned, seq } = payload.value;
      return {
        channelId,
        seq,
        patches: messageId,
        apply: (log) =>
          patched(log, messageId, seq, (held) => ({ ...held, pinned })),
      };
    }
    case "threadChanged": {
      const { channelId, rootMessageId, thread, seq } = payload.value;
      return {
        channelId,
        seq,
        patches: rootMessageId,
        apply: (log) =>
          patched(log, rootMessageId, seq, (held) => ({
            ...held,
            thread: withViewerHalf(thread, held.thread),
          })),
      };
    }
    case "messageDeleted": {
      const deletion = payload.value;
      return {
        channelId: deletion.channelId,
        seq: deletion.seq,
        apply: (log) =>
          withArrivals(
            log,
            [tombstoneOf(log.rows.get(deletion.messageId), deletion)],
            FROM_EVENT,
          ),
      };
    }
    default:
      return null;
  }
}

// The held row with the change, at the event's seq. A row that isn't held
// has nothing to patch.
function patched(
  log: ChannelLog,
  id: string,
  seq: bigint,
  change: (held: Message) => Message,
): ChannelLog {
  const held = log.rows.get(id);
  if (!held) return log;
  return withArrivals(log, [{ ...change(held), seq }], FROM_EVENT);
}
