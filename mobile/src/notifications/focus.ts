import { useEffect } from "react";

// The conversation on screen, if one is: a channel or a direct message,
// or one thread in it. A notification for what is being read as it
// arrives says nothing (quiet.ts). Kept outside React so that whatever
// decides a notification's fate can ask without a component around it.

export type FocusedPlace = { serverId: string; channelId: string; threadRootId?: string };

let place: FocusedPlace | null = null;

export const focusedPlace = (): FocusedPlace | null => place;

export function setFocusedPlace(next: FocusedPlace) {
  place = next;
}

// Clears the place only while it is still the caller's: the screen
// pushed over it may have set its own first.
export function clearFocusedPlace(mine: FocusedPlace) {
  if (place === mine) place = null;
}

// Says a channel screen, or a thread screen with its root, is the place
// on screen for as long as onScreen holds (focused, with the app in
// front).
export function useFocusedPlace({ serverId, channelId, threadRootId }: FocusedPlace, onScreen: boolean) {
  useEffect(() => {
    if (!onScreen) return;
    const mine = { serverId, channelId, threadRootId };
    setFocusedPlace(mine);
    return () => clearFocusedPlace(mine);
  }, [serverId, channelId, threadRootId, onScreen]);
}
