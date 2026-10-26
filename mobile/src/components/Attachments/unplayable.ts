import { useSyncExternalStore } from "react";

// The videos and audio files this phone has found it can't play, by file
// id, for as long as the app runs: the viewer or the audio player finds
// out when it tries, and the timeline then draws each as the plain card,
// whose tap shares it (layout.ts), as web turns a file it can't decode
// into its download card.

let ids: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

export function markUnplayable(fileId: string) {
  if (ids.has(fileId)) return;
  ids = new Set([...ids, fileId]);
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useUnplayable = () => useSyncExternalStore(subscribe, () => ids);

export const isUnplayable = (fileId: string) => ids.has(fileId);
