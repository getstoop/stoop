import { create } from "zustand";

// The app's own confirm / prompt / notice, in place of the browser's.
// Call sites await a promise, as they did with window.confirm; the
// pending request is rendered by components/DialogHost.tsx at the root
// route. Requests queue, so an error notice raised while a confirm is
// open shows after it.

export interface ConfirmOptions {
  title: string;
  body?: string;
  action?: string;
  cancel?: string;
  danger?: boolean;
}

export interface PromptOptions {
  title: string;
  body?: string;
  label?: string;
  initial?: string;
  placeholder?: string;
  action?: string;
  danger?: boolean;
  // The action stays disabled until the typed value equals this: the
  // "type the name to delete it" pattern.
  match?: string;
  // A textarea instead of a one-line input, for answers long enough that
  // typing into a single line is miserable.
  multiline?: boolean;
  // Caps the field and shows a countdown beside the label.
  maxLength?: number;
  // Lets a blank answer through, so clearing the field means "remove it"
  // rather than "cancel". Never combined with match.
  allowEmpty?: boolean;
}

export interface NoticeOptions {
  title: string;
  body?: string;
}

export type DialogRequest =
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (ok: boolean) => void }
  | {
      kind: "prompt";
      opts: PromptOptions;
      resolve: (value: string | null) => void;
    }
  | { kind: "notice"; opts: NoticeOptions; resolve: () => void };

interface DialogState {
  queue: DialogRequest[];
  push: (r: DialogRequest) => void;
  // Drops the request at the head; the caller has already resolved it.
  shift: () => void;
}

export const useDialogStore = create<DialogState>((set) => ({
  queue: [],
  push: (r) => set((s) => ({ queue: [...s.queue, r] })),
  shift: () => set((s) => ({ queue: s.queue.slice(1) })),
}));

// True while a dialog is on screen. Popovers that dismiss themselves on
// an outside click or Escape ask this first: the dialog is above them,
// and its click — and its Escape — belong to it.
export function dialogOpen(): boolean {
  return useDialogStore.getState().queue.length > 0;
}

export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) =>
    useDialogStore.getState().push({ kind: "confirm", opts, resolve }),
  );
}

export function prompt(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) =>
    useDialogStore.getState().push({ kind: "prompt", opts, resolve }),
  );
}

export function notice(opts: NoticeOptions): Promise<void> {
  return new Promise((resolve) =>
    useDialogStore.getState().push({ kind: "notice", opts, resolve }),
  );
}
