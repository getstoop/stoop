import { useSyncExternalStore } from "react";
import { fileAnswers } from "../../api/downloads";

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

// Why a player (the viewer's video, the inline audio) gave up on a file:
// one this phone can't decode, which the player then marks above while
// its answer is still the current try's, or one it couldn't load. A failure once the file has loaded is taken for the
// network's, even when it was the decoder's part-way through: a retry
// costs a tap, a card would stand for the rest of the run, and a drop
// mid-play that recovers would answer the probe and be called
// undecodable. One before is asked of the file's first byte with the
// session (fileAnswers): a file the server still hands over is one the
// phone can't decode; one that doesn't answer (offline, a session gone,
// refused) couldn't load.
export async function whyFailed(
  origin: string,
  token: string,
  fileId: string,
  loaded: boolean,
): Promise<"unplayable" | "unloaded"> {
  return loaded || !(await fileAnswers(origin, token, fileId)) ? "unloaded" : "unplayable";
}
