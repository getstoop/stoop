import type { LastSpaceStore } from "../../lastSpace/store";

// How the wait for the tab ended: it answered (the space picked, if its
// list holds it by then), something else asked for another space first
// (a tapped notification, a shared link, which see to the sheet
// themselves), or nothing answered in time.
export type Landing = "answered" | "replaced" | "gave-up";

// Asks the Spaces tab under the sheet for the space just joined and
// waits until it has answered: the tab reloads its spaces for a space
// it doesn't hold yet, and picks it once it does (useSelectedSpace.ts).
// The wait ends on its own after `giveUpMs`, should the tab be slow or
// not there; what was asked stays asked, so the tab picks the space
// whenever it next answers.
export function landOn(store: LastSpaceStore, serverId: string, spaceId: string, giveUpMs: number): Promise<Landing> {
  return new Promise((resolve) => {
    let unsubscribe = () => {};
    const done = (how: Landing) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(how);
    };
    const timer = setTimeout(() => done("gave-up"), giveUpMs);
    unsubscribe = store.subscribe(() => {
      const asked = store.asked(serverId);
      if (asked !== spaceId) done(asked === undefined ? "answered" : "replaced");
    });
    store.ask(serverId, spaceId);
  });
}

// Takes back what `landOn` asked, if it is still what is asked: the
// sheet was closed while it waited, so nothing is to be picked.
export function withdraw(store: LastSpaceStore, serverId: string, spaceId: string): void {
  if (store.asked(serverId) === spaceId) store.answered(serverId);
}
