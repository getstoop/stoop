import { createContext, type ReactNode } from "react";

// What the composer shows over itself (its mention list), handed to the
// dock to draw: the dock spans the screen, so the list is inside a parent
// that takes its taps on Android too, and the timeline under it is left
// where it is.
export const ComposerAbove = createContext<(node: ReactNode) => void>(() => {});

// What the composer shows over the whole dock (its link dialog, on
// Android): drawn in the dock's own window, over the list and the card
// and above the keyboard, so the keyboard never goes down and comes back
// as it would for a window of the dialog's own.
export const ComposerOverlay = createContext<(node: ReactNode) => void>(() => {});
