import { create } from "zustand";

// Whether the composer shows its formatting row: a choice about this
// device, kept in localStorage like the voice cues, and one choice for
// every composer (a channel's and a thread's). Hidden until someone asks
// for it; the formatting keys work either way.

export const COMPOSER_FORMATTING_STORAGE_KEY = "stoop.composerFormatting";

interface ComposerFormattingState {
  shown: boolean;
  setShown: (shown: boolean) => void;
}

function load(): boolean {
  try {
    return localStorage.getItem(COMPOSER_FORMATTING_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export const useComposerFormattingStore = create<ComposerFormattingState>(
  (set) => ({
    shown: load(),
    setShown: (shown) => {
      try {
        localStorage.setItem(
          COMPOSER_FORMATTING_STORAGE_KEY,
          shown ? "on" : "off",
        );
      } catch {
        // Private mode or storage disabled: the choice lasts for this page.
      }
      set({ shown });
    },
  }),
);
