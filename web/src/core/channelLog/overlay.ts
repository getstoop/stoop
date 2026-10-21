import type { ThreadSummary } from "../../gen/stoop/chat/v1/message_pb";
import type { ChannelLog } from "./types";

// The reader's own half of a root's thread summary: not a row fact, so it
// carries no seq. The server fills it per request; the app patches it
// here from its own read and mute events, on the held copy at the held
// seq. A threadChanged event keeps it through withViewerHalf (rows.ts).
export type ThreadOverlay = Partial<
  Pick<ThreadSummary, "participating" | "muted" | "unreadCount">
>;

// Nothing when the root isn't held, has no summary, or already reads so.
export function withThreadOverlay(
  log: ChannelLog,
  rootId: string,
  patch: ThreadOverlay,
): ChannelLog {
  const held = log.rows.get(rootId);
  if (!held?.thread) return log;
  const thread = { ...held.thread, ...patch };
  if (
    thread.participating === held.thread.participating &&
    thread.muted === held.thread.muted &&
    thread.unreadCount === held.thread.unreadCount
  )
    return log;
  const rows = new Map(log.rows);
  rows.set(rootId, { ...held, thread });
  return { ...log, rows };
}
