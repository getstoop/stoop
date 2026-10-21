import type { Message } from "../../gen/stoop/chat/v1/message_pb";
import { withArrivals } from "./arrivals";
import { retired } from "./pending";
import type { ChannelLog } from "./types";

// The reader's own sends. A draft (a client-made id, seq 0) is shown at
// the bottom until the server answers; the answer's row joins the log
// like an event's and retires the draft. The created event may come first
// and retire it by likeness (pending.ts); either order ends with the one
// row.

export function sendStarted(log: ChannelLog, draft: Message): ChannelLog {
  return { ...log, pending: [...log.pending, draft] };
}

export function sendSucceeded(
  log: ChannelLog,
  draftId: string,
  row: Message,
): ChannelLog {
  return withArrivals(retired(log, draftId), [row], "send");
}

// The composer shows the error; the draft leaves the list.
export function sendFailed(log: ChannelLog, draftId: string): ChannelLog {
  return retired(log, draftId);
}
