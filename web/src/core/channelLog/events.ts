import type { Message } from "../../gen/stoop/chat/v1/message_pb";
import type { ServerEvent } from "../../gen/stoop/realtime/v1/realtime_pb";
import { withArrivals } from "./arrivals";
import { withViewerHalf } from "./rows";
import { tombstoneOf } from "./tombstone";
import type { ChannelLog } from "./types";

// What a realtime event about a message does to its channel's log. Each
// kind yields a row at the event's seq, merged by seq like any other
// arrival. Then the position: the next seq is applied and known; one
// further on is applied too (higher wins) but marks a gap, so a catch-up
// is owed; one at or below what is known is ignored. Before the first page
// (seq 0) rows are kept and the page's channelSeq decides the position.
export function withEvent(log: ChannelLog, event: ServerEvent): ChannelLog {
  const change = changeOf(event);
  if (!change || change.channelId !== log.channelId) return log;
  const seq = Number(change.seq);
  if (log.seq > 0 && seq <= log.seq) return log;
  const next = change.apply(log);
  if (log.seq === 0) return next;
  if (seq === log.seq + 1) return { ...next, seq };
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
        apply: (log) => withArrivals(log, [row], true),
      };
    }
    case "reactionsChanged": {
      const { channelId, messageId, reactions, seq } = payload.value;
      return {
        channelId,
        seq,
        apply: (log) =>
          patched(log, messageId, seq, (held) => ({ ...held, reactions })),
      };
    }
    case "messagePinned": {
      const { channelId, messageId, pinned, seq } = payload.value;
      return {
        channelId,
        seq,
        apply: (log) =>
          patched(log, messageId, seq, (held) => ({ ...held, pinned })),
      };
    }
    case "threadChanged": {
      const { channelId, rootMessageId, thread, seq } = payload.value;
      return {
        channelId,
        seq,
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
            true,
          ),
      };
    }
    default:
      return null;
  }
}

// The held row with the change, at the event's seq. A row that isn't held
// has nothing to patch; the event's position still counts.
function patched(
  log: ChannelLog,
  id: string,
  seq: bigint,
  change: (held: Message) => Message,
): ChannelLog {
  const held = log.rows.get(id);
  if (!held) return log;
  return withArrivals(log, [{ ...change(held), seq }], true);
}
