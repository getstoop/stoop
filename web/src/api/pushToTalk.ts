import { create } from "zustand";

// Push to talk: the mic stays shut, and holding Ctrl+` opens it. Whether
// it is on is a choice about this device (a fan, a keyboard, a family),
// so it is kept in localStorage like the voice cues and never on the
// server. The keys are watched by hooks/usePushToTalk.ts; the mic is
// opened and shut by setTransmitting in api/voice.ts.

export const PUSH_TO_TALK_STORAGE_KEY = "stoop.pushToTalk";

// How long the mic stays open after the key comes up, so the last
// syllable is not clipped.
export const RELEASE_TAIL_MS = 70;

interface PushToTalkState {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

function load(): boolean {
  try {
    return localStorage.getItem(PUSH_TO_TALK_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export const usePushToTalkStore = create<PushToTalkState>((set) => ({
  enabled: load(),
  setEnabled: (enabled) => {
    try {
      localStorage.setItem(PUSH_TO_TALK_STORAGE_KEY, enabled ? "on" : "off");
    } catch {
      // Private mode or storage disabled: the choice lasts for this page.
    }
    set({ enabled });
  },
}));

export interface Hold {
  press: () => void;
  release: () => void;
  // Something may have taken the keyup away (the window lost focus, the
  // tab was hidden): shut at once, without the tail. The failure this
  // guards against is an open mic nobody knows about.
  cut: () => void;
}

// The hold, apart from the mic it drives. transmit(true) when the key
// goes down, transmit(false) a tail after it comes up; pressing again
// inside the tail keeps the mic open rather than shutting and reopening.
// Every press asks to open, even inside the tail: the last open may have
// been refused (deafened then), and opening an open mic does nothing.
export function createHold(
  transmit: (open: boolean) => void,
  tailMs = RELEASE_TAIL_MS,
): Hold {
  let held = false;
  let tail: ReturnType<typeof setTimeout> | null = null;
  const clearTail = () => {
    if (tail) clearTimeout(tail);
    tail = null;
  };
  return {
    press() {
      if (held) return;
      held = true;
      clearTail();
      transmit(true);
    },
    release() {
      if (!held) return;
      held = false;
      tail = setTimeout(() => {
        tail = null;
        transmit(false);
      }, tailMs);
    },
    cut() {
      const open = held || tail !== null;
      held = false;
      clearTail();
      if (open) transmit(false);
    },
  };
}
