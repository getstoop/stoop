import type { Message } from "../../gen/stoop/chat/v1/message_pb";

// One log per channel (docs/proposals/channel-log.md): every row known by
// id, the position through which every change is known, and the views
// that range over it. The rules that change one are the functions beside
// this file; each returns the same object when nothing changed.

// How many shown rows a view holds before its far end is pruned.
export const LOG_CAP = 2000;

// A contiguous range of the log a list shows: the channel's timeline, or
// one thread's replies. Ids are UUIDv7, so the range is two ids and a row
// is inside it by comparison. generation moves when the range is
// replaced, so a page asked for the old range is dropped when it answers.
export type View = {
  oldestId: string | null;
  newestId: string | null;
  hasOlder: boolean;
  hasNewer: boolean;
  // Rows that arrived beyond a range that stops short of the newest
  // (hasNewer): held, counted on the "Jump to latest" pill, not shown.
  pendingNewer: number;
  generation: number;
};

export type ChannelLog = {
  channelId: string;
  // The log position through which every change is known; 0 before the
  // first page, and after it while the channel has had no writes (hasPage
  // in pages.ts tells the two apart). A bigint on the wire, a number here
  // (safe below 2^53).
  seq: number;
  // The highest seq any event about the channel has carried, whether or
  // not it was applied. A load that sets the position (the first page, a
  // catch-up's last page) covers the changes through the seq the server
  // read before its rows, so an event seen above that was not covered and
  // keeps the catch-up owed (position.ts).
  seenSeq: number;
  // Every row known, by id, tombstones (deleted) included. Replaced, never
  // mutated, so a list can tell at a glance whether anything changed.
  rows: ReadonlyMap<string, Message>;
  channel: View;
  // One per open thread, by its root's id.
  threads: Record<string, View>;
  // The retention floor's id, "" when retention is off.
  floor: string;
  // A gap was seen in the sequence, or the socket reconnected: a
  // ListChanges from seq is owed.
  needsCatchUp: boolean;
};

// A view before its first page: nothing shown, and not live until a page
// says the range reaches the newest row.
export const emptyView: View = {
  oldestId: null,
  newestId: null,
  hasOlder: false,
  hasNewer: true,
  pendingNewer: 0,
  generation: 0,
};

export function emptyLog(channelId: string): ChannelLog {
  return {
    channelId,
    seq: 0,
    seenSeq: 0,
    rows: new Map(),
    channel: emptyView,
    threads: {},
    floor: "",
    needsCatchUp: false,
  };
}
