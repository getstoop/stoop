import { type LastSpaces, withoutServer, withSpace } from "./lastSpaces";

// The last space of each server (lastSpaces.ts), held outside React so
// the Spaces tab can wait for the saved map before it picks a space.
// Nothing is known until that map is read: a change made before then
// waits, and is laid over what was saved once it is.
export type LastSpaceStore = {
  // Undefined until the saved map is read; then the same object until
  // it changes.
  current: () => LastSpaces | undefined;
  subscribe: (listener: () => void) => () => void;
  // The saved map, read as the app starts. Only the first counts.
  loaded: (saved: LastSpaces) => void;
  // A server's tab shows this space now.
  remember: (serverId: string, spaceId: string) => void;
  // A removed server's space goes with it.
  forgetServer: (serverId: string) => void;
  // A space asked for from outside the tab (a shared link to it), held
  // until the tab, which knows the server's spaces, answers: it is
  // remembered only if the account is in it. Not saved.
  ask: (serverId: string, spaceId: string) => void;
  asked: (serverId: string) => string | undefined;
  answered: (serverId: string) => void;
};

type Change = (spaces: LastSpaces) => LastSpaces;

export function lastSpaceStore(save: (next: LastSpaces) => void): LastSpaceStore {
  let spaces: LastSpaces | undefined;
  let waiting: Change[] = [];
  const asked = new Map<string, string>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  // Saves and tells only what differs from before.
  const apply = (change: Change) => {
    if (spaces === undefined) {
      waiting.push(change);
      return;
    }
    const next = change(spaces);
    if (next === spaces) return;
    spaces = next;
    save(spaces);
    notify();
  };
  return {
    current: () => spaces,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    loaded: (saved) => {
      if (spaces !== undefined) return;
      spaces = waiting.reduce((soFar, change) => change(soFar), saved);
      waiting = [];
      if (spaces !== saved) save(spaces);
      notify();
    },
    remember: (serverId, spaceId) => apply((before) => withSpace(before, serverId, spaceId)),
    forgetServer: (serverId) => apply((before) => withoutServer(before, serverId)),
    ask: (serverId, spaceId) => {
      asked.set(serverId, spaceId);
      notify();
    },
    asked: (serverId) => asked.get(serverId),
    answered: (serverId) => {
      if (asked.delete(serverId)) notify();
    },
  };
}
