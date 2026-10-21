import type { Message } from "../../gen/stoop/chat/v1/message_pb";
import { isShown, showsInChannel } from "./rows";
import type { ChannelLog, View } from "./types";
import { shownRows } from "./views";

// What a list renders from a log. Each selector keeps its last answer per
// view and hands it back while the rows and the pending sends are the
// same objects, so a change elsewhere in the log does not redraw a list.

const EMPTY: Message[] = [];

type Listed = {
  rows: ChannelLog["rows"];
  pending: Message[];
  items: Message[];
};
const listed = new WeakMap<View, Listed>();

// The channel's rows inside its range, oldest first, then the reader's
// pending sends. Hidden tombstones and replies that stay in their thread
// are not among them; a deleted root with replies is, as a placeholder.
export function channelItems(log: ChannelLog): Message[] {
  return remembered(log.channel, log, () => [
    ...sorted(shownRows(log, undefined)),
    ...log.pending.filter(showsInChannel),
  ]);
}

// A thread's root, when held and shown, then its replies inside the
// thread's range, then the reader's pending replies.
export function threadItems(log: ChannelLog, rootId: string): Message[] {
  const view = log.threads[rootId];
  if (!view) return EMPTY;
  return remembered(view, log, () => {
    const root = log.rows.get(rootId);
    return [
      ...(root && isShown(root) ? [root] : []),
      ...sorted(shownRows(log, rootId)),
      ...log.pending.filter((draft) => draft.threadRootId === rootId),
    ];
  });
}

// A view that reaches the newest row: arrivals extend it.
export const isLive = (view: View): boolean => !view.hasNewer;

// Rows that arrived beyond a view that stops short of the newest.
export const pendingNewer = (view: View): number => view.pendingNewer;

function remembered(
  view: View,
  log: ChannelLog,
  build: () => Message[],
): Message[] {
  const last = listed.get(view);
  if (last && last.rows === log.rows && last.pending === log.pending)
    return last.items;
  const items = build();
  listed.set(view, { rows: log.rows, pending: log.pending, items });
  return items;
}

const sorted = (rows: Message[]) =>
  rows.sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
