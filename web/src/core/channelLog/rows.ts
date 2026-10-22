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

// Where an arriving copy came from, which decides a tie and the reader's
// half of a thread summary.
export type Source = {
  // The server's read path (a page, a ListChanges page, an RPC's answer)
  // hands out the whole row, so its copy replaces a held one at the same
  // seq: an event may have patched that one partially (a reaction on top
  // of an edit the socket missed) and stamped it with the seq the whole
  // row then arrives under. An event's copy needs a strictly higher seq.
  fromServer: boolean;
  // The copy carries only the shared half of a thread summary (an
  // event's, a send's or an edit's answer), so the reader's own half
  // (participating, muted, unreadCount) stays from the held copy.
  keepViewerHalf: boolean;
};

export const FROM_EVENT: Source = { fromServer: false, keepViewerHalf: true };
export const FROM_PAGE: Source = { fromServer: true, keepViewerHalf: false };
export const FROM_ANSWER: Source = { fromServer: true, keepViewerHalf: true };

// Merge by seq: an arriving copy replaces the held one when its seq is
// higher, or equal and the copy is the server's.
export function mergeRows(
  rows: ReadonlyMap<string, Message>,
  incoming: Message[],
  source: Source,
): ReadonlyMap<string, Message> {
  let next: Map<string, Message> | null = null;
  for (const row of incoming) {
    const held = rows.get(row.id);
    if (held && !wins(row, held, source)) continue;
    next ??= new Map(rows);
    next.set(
      row.id,
      held && source.keepViewerHalf
        ? { ...row, thread: withViewerHalf(row.thread, held.thread) }
        : row,
    );
  }
  return next ?? rows;
}

const wins = (row: Message, held: Message, source: Source) =>
  source.fromServer ? seqOf(row) >= seqOf(held) : seqOf(row) > seqOf(held);

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
