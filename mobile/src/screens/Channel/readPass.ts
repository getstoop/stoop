// How the channel screen reads what it shows, given the facts and the
// requests: what a pass does, when `looked` falls, and what a failed read
// leaves behind. Which arriving items its event reads, and starting afresh
// for another channel, are the screen's.

// What a pass does, once the screen is showing the channel's newest row
// with the app open.
//
// moveMarker: the newest row is past the reader's marker. Moving it also
// reads, on the server, the activity about every message it passes
// (docs/architecture/messaging.md, A read marker reads the activity it
// passes), so a new row needs nothing more.
//
// readActivity: the feed's unread items for the channel are asked for and
// read. That is a ListActivity, and it is what reads an item the marker
// has already gone past, so it goes once each time the reader comes to
// the channel (looked is false), not once a row. While a catch-up is
// owed looked stays false, so the rows it brings count as coming to the
// channel, and with nothing newer to mark the pass waits for it to land:
// an item whose event went with the socket has nothing else to read it.
//
// Null when there is nothing to do.
export type ReadPass = { moveMarker: boolean; readActivity: boolean };

export function readPass(
  newestId: string,
  readTo: string,
  marked: string,
  looked: boolean,
  owing: boolean,
): ReadPass | null {
  const moveMarker = newestId > readTo && newestId > marked;
  if (!moveMarker && (looked || owing)) return null;
  return { moveMarker, readActivity: !looked };
}

// What the screen remembers between passes: whether the channel's activity
// has been read since it came on screen, and the marker it moved. Refs, so
// the screen can start them afresh for another channel.
export type ReadMemory = {
  looked: { current: boolean };
  marked: { current: string };
};

export type Shown = {
  // The newest row, the marker and the session are all there.
  loaded: boolean;
  newestId: string;
  readTo: string;
  // The screen is on top with the app open.
  onScreen: boolean;
  // The range stops short of the newest message, whose newest row is not
  // the channel's. An item arriving then is not read by its event.
  hasNewer: boolean;
  // A catch-up is owed, after a reconnect or a gap in the events.
  owing: boolean;
};

export type ReadRequests = {
  readActivity: () => Promise<number>;
  moveMarker: () => Promise<unknown>;
};

// Whether what arrived has still been read: not while the screen could
// not read it.
const stillLooked =(looked: boolean, { onScreen, hasNewer, owing }: Shown) =>
  looked && onScreen && !hasNewer && !owing;

// One pass over what the screen shows. A feed read that fails lets the
// next pass go again; a marker that fails can be moved again.
export function readShown(memory: ReadMemory, shown: Shown, requests: ReadRequests): Promise<void> | undefined {
  const { looked, marked } = memory;
  looked.current = stillLooked(looked.current, shown);
  if (!shown.loaded || !shown.onScreen || shown.hasNewer) return;
  const pass = readPass(shown.newestId, shown.readTo, marked.current, looked.current, shown.owing);
  if (!pass) return;
  if (!shown.owing) looked.current = true;
  if (pass.moveMarker) marked.current = shown.newestId;
  const read = pass.readActivity
    ? requests.readActivity().catch(() => {
        looked.current = false;
        return 0;
      })
    : Promise.resolve(0);
  return read
    .then(async (count) => {
      if (pass.moveMarker || count > 0) await requests.moveMarker();
    })
    .catch(() => {
      if (marked.current === shown.newestId) marked.current = "";
    });
}

// An item its own event reads, the same way: a failure lets the next pass
// go again.
export function readArrived(looked: ReadMemory["looked"], read: () => Promise<unknown>): Promise<void> {
  return read().then(
    () => {},
    () => {
      looked.current = false;
    },
  );
}
