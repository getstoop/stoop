import { createContext, type ReactNode } from "react";

// What the composer shows over itself (its mention list), handed to the
// dock to draw: the dock spans the screen, so the list is inside a parent
// that takes its taps on Android too, and the timeline under it is left
// where it is.
export const ComposerAbove = createContext<(node: ReactNode) => void>(() => {});
