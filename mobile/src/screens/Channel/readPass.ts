// How the channel screen keeps the reader's marker at the newest row it
// shows, given the facts: when a pass moves it, and what a failed move
// leaves behind. Moving it reads, on the server, the activity about
// every message it passes, and the alert counts follow the marker
// (docs/architecture/messaging.md → Reads and unreads, Alert counts), so
// nothing is read here. An item recorded after the marker moved is the
// screen's own event to move it again for.

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
