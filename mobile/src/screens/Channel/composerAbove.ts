import { createContext, type ReactNode, useContext, useEffect } from "react";

// What the composer shows over itself (its mention list or its command
// list), handed to the dock to draw: the dock spans the screen, so the
// list is inside a parent that takes its taps on Android too, and the
// timeline under it is left where it is.
export const ComposerAbove = createContext<(node: ReactNode) => void>(() => {});

// The composer's one say in what is over it: a list, or nothing. One
// caller only, so the lists never take the place from each other; pass a
// node that is the same from render to render while nothing changes.
export function useComposerAbove(node: ReactNode) {
  const showAbove = useContext(ComposerAbove);
  useEffect(() => showAbove(node), [node, showAbove]);
  useEffect(() => () => showAbove(null), [showAbove]);
}

// What the composer shows over the whole dock (its link dialog, on
// Android): drawn in the dock's own window, over the list and the card
// and above the keyboard, so the keyboard never goes down and comes back
// as it would for a window of the dialog's own.
export const ComposerOverlay = createContext<(node: ReactNode) => void>(() => {});
