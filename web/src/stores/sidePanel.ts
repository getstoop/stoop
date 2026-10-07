import { create } from "zustand";

// The right-hand side panel (components/SidePanel): which content it
// shows, or nothing. Held by the app, not the URL, so it stays open across
// channel and space changes until it is closed or replaced, and saved per
// tab so a reload keeps it. docs/architecture/web.md → The side panel.
export interface OpenPanel {
  // A key of the registry (components/SidePanel/registry.ts).
  kind: string;
  params: Record<string, string>;
}

interface SidePanelState {
  open: OpenPanel | null;
  show: (panel: OpenPanel) => void;
  close: () => void;
}

const STORAGE_KEY = "stoop.sidePanel";

// Whoever had focus when the panel opened gets it back when it closes.
let opener: HTMLElement | null = null;

export function takeOpener(): HTMLElement | null {
  const element = opener;
  opener = null;
  return element;
}

function load(): OpenPanel | null {
  try {
    const parsed: unknown = JSON.parse(
      sessionStorage.getItem(STORAGE_KEY) ?? "null",
    );
    if (!parsed || typeof parsed !== "object") return null;
    const { kind, params } = parsed as Record<string, unknown>;
    if (typeof kind !== "string" || !params || typeof params !== "object")
      return null;
    const entries = Object.entries(params);
    if (entries.some(([, value]) => typeof value !== "string")) return null;
    return {
      kind,
      params: Object.fromEntries(entries) as Record<string, string>,
    };
  } catch {
    return null;
  }
}

function save(panel: OpenPanel | null) {
  try {
    if (panel) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(panel));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private windows and blocked storage: the panel just won't survive a reload.
  }
}

export const useSidePanelStore = create<SidePanelState>((set, get) => ({
  open: load(),
  show: (panel) => {
    if (!get().open && document.activeElement instanceof HTMLElement) {
      opener = document.activeElement;
    }
    save(panel);
    set({ open: panel });
  },
  close: () => {
    save(null);
    set({ open: null });
  },
}));

// Opens content in the side panel, replacing whatever it showed.
export function openSidePanel(kind: string, params: Record<string, string>) {
  useSidePanelStore.getState().show({ kind, params });
}
