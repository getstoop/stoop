import { create } from "zustand";

// Narrow-screen navigation. Below the mobile breakpoint (styles/mobile.css)
// the space rail and channel sidebar are one drawer that slides in over
// the content; this is the only state it needs. Whether the drawer
// applies at all is decided by CSS, so on a wide screen the flag is
// harmless.
interface LayoutState {
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  drawerOpen: false,
  openDrawer: () => set({ drawerOpen: true }),
  closeDrawer: () => set({ drawerOpen: false }),
  toggleDrawer: () => set((s) => ({ drawerOpen: !s.drawerOpen })),
}));
