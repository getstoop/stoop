import { create } from "zustand";

// What a screen reader is told about a change that only shows on screen:
// a row leaving the sidebar, say. components/Announcer.tsx holds the
// hidden live region that speaks it; docs/architecture/web.md → State.
interface AnnouncerState {
  message: string;
}

export const useAnnouncerStore = create<AnnouncerState>(() => ({
  message: "",
}));

// Long enough for the cleared region to be seen as a change.
const GAP_MS = 50;
let pending: ReturnType<typeof setTimeout> | undefined;

// Speaks a short sentence, politely: after whatever is being read now.
// The region is emptied first, so the same sentence twice is said twice.
export function announce(message: string) {
  clearTimeout(pending);
  useAnnouncerStore.setState({ message: "" });
  pending = setTimeout(() => useAnnouncerStore.setState({ message }), GAP_MS);
}
