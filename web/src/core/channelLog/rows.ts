import type {
  Message,
  ThreadSummary,
} from "../../gen/stoop/chat/v1/message_pb";

// The rows of a channel log: which copy of a row wins, and which rows are
// shown.

export const seqOf = (row: Message): number => Number(row.seq);

// A tombstone stays hidden unless it is the placeholder root of a thread
// that still has replies.
export function isShown(row: Message): boolean {
  return !row.deleted || (row.thread?.replyCount ?? 0) > 0;
}

// Whether a row is listed in the channel's timeline, range aside: a
// top-level message, or a reply also sent to the channel.
export function showsInChannel(row: Message): boolean {
  return !row.threadRootId || row.inChannel;
}

// Merge by seq: an arriving copy replaces the held one only when its seq
// is higher. An event carries only the thread summary's shared half, so
// with keepViewerHalf the reader's own half stays from the held copy; a
// page or a catch-up carries the reader's half and is taken whole.
export function mergeRows(
  rows: ReadonlyMap<string, Message>,
  incoming: Message[],
  keepViewerHalf: boolean,
): ReadonlyMap<string, Message> {
  let next: Map<string, Message> | null = null;
  for (const row of incoming) {
    const held = rows.get(row.id);
    if (held && seqOf(held) >= seqOf(row)) continue;
    next ??= new Map(rows);
    next.set(
      row.id,
      held && keepViewerHalf
        ? { ...row, thread: withViewerHalf(row.thread, held.thread) }
        : row,
    );
  }
  return next ?? rows;
}

// A summary from an event, with the reader's own half (participating,
// muted, unreadCount) from the held one.
export function withViewerHalf(
  next: ThreadSummary | undefined,
  held: ThreadSummary | undefined,
): ThreadSummary | undefined {
  if (!next || !held) return next;
  return {
    ...next,
    participating: held.participating,
    muted: held.muted,
    unreadCount: held.unreadCount,
  };
}

// The rows without those named, or the same map when none is held.
export function withoutRows(
  rows: ReadonlyMap<string, Message>,
  ids: Iterable<string>,
): ReadonlyMap<string, Message> {
  let next: Map<string, Message> | null = null;
  for (const id of ids) {
    if (!rows.has(id)) continue;
    next ??= new Map(rows);
    next.delete(id);
  }
  return next ?? rows;
}
