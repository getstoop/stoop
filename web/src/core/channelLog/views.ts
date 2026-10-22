import type { Message } from "../../gen/stoop/chat/v1/message_pb";
import { isShown, showsInChannel } from "./rows";
import { type ChannelLog, emptyView, type View } from "./types";

// The views of a log: the channel's (rootId undefined) and one per open
// thread, and what a row's arrival does to the range each shows.

export function viewOf(log: ChannelLog, rootId?: string): View | undefined {
  return rootId === undefined ? log.channel : log.threads[rootId];
}

export function withView(
  log: ChannelLog,
  rootId: string | undefined,
  view: View,
): ChannelLog {
  if (rootId === undefined) {
    return log.channel === view ? log : { ...log, channel: view };
  }
  if (log.threads[rootId] === view) return log;
  return { ...log, threads: { ...log.threads, [rootId]: view } };
}

export function withoutView(log: ChannelLog, rootId: string): ChannelLog {
  if (!(rootId in log.threads)) return log;
  const { [rootId]: _gone, ...threads } = log.threads;
  return { ...log, threads };
}

export function inRange(view: View, id: string): boolean {
  return (
    view.oldestId !== null &&
    view.newestId !== null &&
    id >= view.oldestId &&
    id <= view.newestId
  );
}

// Whether a view lists the row, range aside.
export function belongs(row: Message, rootId: string | undefined): boolean {
  return rootId === undefined
    ? showsInChannel(row)
    : row.threadRootId === rootId;
}

// Whether a row is listed by some view, or is the root of an open thread:
// what keeps it in the map when a view lets go of it.
export function referenced(log: ChannelLog, row: Message): boolean {
  if (showsInChannel(row) && inRange(log.channel, row.id)) return true;
  if (row.id in log.threads) return true;
  const thread = row.threadRootId ? log.threads[row.threadRootId] : undefined;
  return !!thread && inRange(thread, row.id);
}

// A view's shown rows, in no order.
export function shownRows(
  log: ChannelLog,
  rootId: string | undefined,
): Message[] {
  const view = viewOf(log, rootId) ?? emptyView;
  const rows: Message[] = [];
  for (const row of log.rows.values()) {
    if (belongs(row, rootId) && inRange(view, row.id) && isShown(row))
      rows.push(row);
  }
  return rows;
}

// A row new to the log, in each view that lists it: inside the range it
// is shown already; beyond the newest end it extends a live range and is
// counted on one that stops short; below the oldest end it joins only a
// range nothing older lies beyond.
export function placed(log: ChannelLog, row: Message): ChannelLog {
  let next = log;
  if (showsInChannel(row))
    next = withView(next, undefined, extended(next.channel, row.id));
  const thread = row.threadRootId ? next.threads[row.threadRootId] : undefined;
  if (thread) next = withView(next, row.threadRootId, extended(thread, row.id));
  return next;
}

function extended(view: View, id: string): View {
  if (inRange(view, id)) return view;
  if (view.newestId === null || id > view.newestId) {
    if (view.hasNewer) return { ...view, pendingNewer: view.pendingNewer + 1 };
    return { ...view, newestId: id, oldestId: view.oldestId ?? id };
  }
  if (!view.hasOlder) return { ...view, oldestId: id };
  return view;
}
