// How the channel screen keeps the reader's marker at the newest row it
// shows, given the facts: when a pass moves it, and what a failed move
// leaves behind. Moving it reads, on the server, the activity about
// every message it passes, and the alert counts follow the marker
// (docs/architecture/messaging.md → Reads and unreads, Alert counts), so
// nothing is read here; an item recorded after the marker passed its
// message is born read.

import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";

// The row the marker follows: the newest shown that is not quiet. A quiet
// row (a system message: the channel renamed, its topic set) marks
// nothing unread, so moving the marker onto one would cost a call, and
// the refetches its channelRead brings, for nothing; the marker stays
// below it, which reads as everything read.
//
// The channel's last message (`lastMessageId`, the header's, never a
// quiet row) instead when it is newer than any message shown but not
// newer than the newest row the log holds (`newestHeld`, the view's
// newestId, quiet and hidden rows included): then the reader is at the
// newest of the channel and every row after its last message is quiet,
// so marking up to it leaves nothing unread behind. That covers a newest
// page of nothing but quiet rows, whose last message is on an older page.
// It does not say the reader saw that message's words. A last message
// beyond what the log holds (a header that answered before the rows, as
// a reconnect's catch-up can) is never marked: the rows have not reached
// the screen. "" when there is nothing to mark.
export function newestToRead(messages: Message[], lastMessageId = "", newestHeld = ""): string {
  const newest = messages.findLast((message) => !message.quiet)?.id ?? "";
  return lastMessageId > newest && lastMessageId <= newestHeld ? lastMessageId : newest;
}

// Whether the newest row is past the reader's marker and not yet marked
// by this screen.
export function markDue(newestId: string, readTo: string, marked: string): boolean {
  return newestId > readTo && newestId > marked;
}

// What the screen remembers between passes: the marker it moved. A ref,
// so the screen can start it afresh for another channel.
export type ReadMemory = { marked: { current: string } };

export type Shown = {
  // The newest row, the marker and the session are all there.
  loaded: boolean;
  newestId: string;
  readTo: string;
  // The screen is on top with the app open.
  onScreen: boolean;
  // The range stops short of the newest message, whose newest row is not
  // the channel's.
  hasNewer: boolean;
};

// One pass over what the screen shows. The marker in `readTo` stays put
// as a header does between events: `marked` is what stops a row being
// marked twice. A move that fails can be made again.
export function readShown(memory: ReadMemory, shown: Shown, moveMarker: () => Promise<unknown>): Promise<void> | undefined {
  const { marked } = memory;
  if (!shown.loaded || !shown.onScreen || shown.hasNewer) return;
  if (!markDue(shown.newestId, shown.readTo, marked.current)) return;
  marked.current = shown.newestId;
  return moveMarker().then(
    () => {},
    () => {
      if (marked.current === shown.newestId) marked.current = "";
    },
  );
}
