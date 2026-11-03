// Whether a thread on screen owes MarkThreadRead now, given the reply count
// it last settled at (readAt; -1 for none yet, or for a read asked for
// again): "done" when nothing changed since; "covered" for a new count
// that needs no request, because the newest reply is the reader's own, sent
// here or on another device, with nothing unread: that send moved the marker
// past everything above it and told every device. A later reply by someone
// else is a new count, and is read. At -1 it is always a read, whoever wrote
// the newest: the first of an opening, and one after a failure.
export function threadReadDue(
  readAt: number,
  replyCount: number,
  unread: number,
  newestIsMine: boolean,
): "done" | "covered" | "read" {
  if (readAt === replyCount && unread === 0) return "done";
  return readAt !== -1 && unread === 0 && newestIsMine ? "covered" : "read";
}
