// What a pass of the channel screen's reading does, once the screen is
// showing the channel's newest row with the app open.
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
