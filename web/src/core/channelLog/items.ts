import type { Message } from "../../gen/stoop/chat/v1/message_pb";
import { isShown } from "./rows";
import type { ChannelLog, View } from "./types";
import { shownRows } from "./views";

// What a list renders from a log. Each selector keeps its last answer per
// view and hands it back while the rows are the same map over the same
// range, or while every item is still the same object, so a change the
// list does not show (a reply in its thread, a row beyond the range, the
// pill's count) leaves its identity alone and the list is not laid out
// again. The loader drops a channel's answers when it forgets the log.

const EMPTY: Message[] = [];

type Listed = {
  rows: ChannelLog["rows"];
  oldestId: string | null;
  newestId: string | null;
  items: Message[];
};
const listed = new Map<string, Listed>();

const keyOf = (log: ChannelLog, rootId: string | undefined) =>
  rootId === undefined ? log.channelId : `${log.channelId}/${rootId}`;

// The channel's rows inside its range, oldest first. Hidden tombstones and
// replies that stay in their thread are not among them; a deleted root
// with replies is, as a placeholder.
export function channelItems(log: ChannelLog): Message[] {
  return remembered(log, undefined, log.channel, () =>
    sorted(shownRows(log, undefined)),
  );
}

// A thread's root, when held and shown, then its replies inside the
// thread's range.
export function threadItems(log: ChannelLog, rootId: string): Message[] {
  const view = log.threads[rootId];
  if (!view) return EMPTY;
  return remembered(log, rootId, view, () => {
    const root = log.rows.get(rootId);
    return [
      ...(root && isShown(root) ? [root] : []),
      ...sorted(shownRows(log, rootId)),
    ];
  });
}

// The channel's remembered answers go with its log; one thread's with its
// view.
export function forgetItems(channelId: string, rootId?: string) {
  if (rootId !== undefined) {
    listed.delete(`${channelId}/${rootId}`);
    return;
  }
  for (const key of [...listed.keys()]) {
    if (key === channelId || key.startsWith(`${channelId}/`))
      listed.delete(key);
  }
}

function remembered(
  log: ChannelLog,
  rootId: string | undefined,
  view: View,
  build: () => Message[],
): Message[] {
  const key = keyOf(log, rootId);
  const last = listed.get(key);
  if (
    last &&
    last.rows === log.rows &&
    last.oldestId === view.oldestId &&
    last.newestId === view.newestId
  )
    return last.items;
  const built = build();
  const items = last && sameItems(last.items, built) ? last.items : built;
  listed.set(key, {
    rows: log.rows,
    oldestId: view.oldestId,
    newestId: view.newestId,
    items,
  });
  return items;
}

const sameItems = (left: Message[], right: Message[]) =>
  left.length === right.length &&
  left.every((row, index) => row === right[index]);

const sorted = (rows: Message[]) =>
  rows.sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
