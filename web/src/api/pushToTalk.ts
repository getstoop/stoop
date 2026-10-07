import { create } from "zustand";

// Push to talk: a key listener, on or off. While you are muted in a call,
// holding Ctrl+` unmutes you and letting go mutes you again. It only
// makes the same mute and unmute calls as everything else, so whatever
// those do (unmuting undeafens) it does too. Whether the listener is on
// is a choice about this device, kept in localStorage like the voice
// cues. The keys are watched by hooks/usePushToTalk.ts.

export const PUSH_TO_TALK_STORAGE_KEY = "stoop.pushToTalk";

// How long after the key comes up the mute is made, so the last syllable
// is not clipped.
export const RELEASE_TAIL_MS = 50;

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

export interface Talk {
  muted: () => boolean;
  mute: () => void;
  unmute: () => void;
}

export interface Hold {
  press: () => void;
  release: () => void;
  // The listener is going away mid-hold: mute now.
  stop: () => void;
}

// The hold, apart from the mic it drives. A press only takes hold when
// you are muted, so the key never mutes a mic you opened yourself. A
// press inside the release tail carries on the same hold.
export function createHold(talk: Talk, tailMs = RELEASE_TAIL_MS): Hold {
  let held = false;
  let tail: ReturnType<typeof setTimeout> | null = null;
  return {
    press() {
      if (held) return;
      if (tail) {
        clearTimeout(tail);
        tail = null;
        held = true;
        return;
      }
      if (!talk.muted()) return;
      held = true;
      talk.unmute();
    },
    release() {
      if (!held) return;
      held = false;
      tail = setTimeout(() => {
        tail = null;
        talk.mute();
      }, tailMs);
    },
    stop() {
      if (!held && !tail) return;
      if (tail) clearTimeout(tail);
      held = false;
      tail = null;
      talk.mute();
    },
  };
}
