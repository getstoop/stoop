import type { LastSpaceStore } from "../../lastSpace/store";

// Asks the Spaces tab under the sheet for the space just joined and
// waits until it has answered: the tab reloads its spaces for a space
// it doesn't hold yet, and picks it once it does (useSelectedSpace.ts).
// The wait ends on its own after `giveUpMs`, should no tab be there to
// answer; the space is then on the rail the next time it loads.
export function landOn(store: LastSpaceStore, serverId: string, spaceId: string, giveUpMs: number): Promise<void> {
  return new Promise((resolve) => {
    let unsubscribe = () => {};
    const done = () => {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const timer = setTimeout(done, giveUpMs);
    unsubscribe = store.subscribe(() => {
      if (store.asked(serverId) !== spaceId) done();
    });
    store.ask(serverId, spaceId);
  });
}
