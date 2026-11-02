import type { SavedServer } from "../api/servers";

// What the app knows of the saved servers. "unread" is not "empty": the
// keychain refused the read (it is locked, or the Android keystore
// failed), so the list is still in there, and only a read that succeeded
// can say what it holds.
export type ServerListView =
  | { state: "reading" }
  | { state: "unread" }
  | { state: "known"; servers: SavedServer[] };

// Holds the list for ServersProvider. Changes run one at a time, each on
// the list the one before it left, so two that overlap (a slow sign-in
// finishing after another) can't each save a list missing the other's
// server. None runs before a read has succeeded, since it would save a
// list built from nothing over the real one. For the same reason no read
// runs after one has: a read can never land on top of a change.
export function serverList(
  load: () => Promise<SavedServer[]>,
  publish: (view: ServerListView) => void,
) {
  let list: SavedServer[] | null = null;
  let reading = false;
  let readAgain = false;
  let queue: Promise<unknown> = Promise.resolve();

  // Does nothing once the list is known. Asked while a read is out, it
  // reads once more if that one fails: the keychain may have opened after
  // that read went in, and no other event may come to say so.
  async function read() {
    if (list) return;
    if (reading) {
      readAgain = true;
      return;
    }
    reading = true;
    do {
      readAgain = false;
      try {
        list = await load();
        publish({ state: "known", servers: list });
        return;
      } catch {
        // Stays unread, for the next try.
      }
    } while (readAgain);
    reading = false;
    publish({ state: "unread" });
  }

  function change(apply: (list: SavedServer[]) => Promise<SavedServer[]>) {
    const next = queue.then(async () => {
      if (!list) throw new Error("the saved servers have not been read");
      const changed = await apply(list);
      list = changed;
      publish({ state: "known", servers: changed });
      return changed;
    });
    queue = next.catch(() => {});
    return next;
  }

  return { read, change };
}
