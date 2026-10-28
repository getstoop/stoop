import { create } from "zustand";

// Voice volume: how loud the call plays on this device, as a percentage
// of what everyone sends. 100 is as sent; past it is a boost, which Web
// Audio allows and an <audio> element's own volume does not, so
// api/voice.ts mixes the room through Web Audio and sets each remote
// track's gain from here. One knob for the whole call. A choice about
// this device's speakers against whatever else it is playing — a game,
// say — so it is kept in localStorage like the voice cues and never on
// the server. The keys that step it (api/shortcuts.ts) have a switch of
// their own, kept the same way. docs/architecture/voice.md → Voice volume.

export const VOICE_VOLUME_STORAGE_KEY = "stoop.voiceVolume";
export const VOLUME_KEYS_STORAGE_KEY = "stoop.volumeKeys";

export const MAX_VOLUME = 200;
export const DEFAULT_VOLUME = 100;
// One key press, or one notch of the slider.
export const VOLUME_STEP = 10;

// A whole number from 0 to the ceiling; anything that is not one reads
// as the default.
export function clampVolume(raw: unknown): number {
  const n = typeof raw === "string" && raw !== "" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_VOLUME;
  return Math.min(MAX_VOLUME, Math.max(0, Math.round(n)));
}

// The gain a volume plays at: 1 is as sent.
export function gainFor(volume: number): number {
  return clampVolume(volume) / 100;
}

interface VoiceVolumeState {
  volume: number;
  // Whether the volume keys step it.
  keys: boolean;
  setVolume: (volume: number) => void;
  setKeys: (keys: boolean) => void;
}

function loadVolume(): number {
  try {
    const raw = localStorage.getItem(VOICE_VOLUME_STORAGE_KEY);
    return raw === null ? DEFAULT_VOLUME : clampVolume(raw);
  } catch {
    return DEFAULT_VOLUME;
  }
}

function loadKeys(): boolean {
  try {
    return localStorage.getItem(VOLUME_KEYS_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or storage disabled: the choice lasts for this page.
  }
}

export const useVoiceVolumeStore = create<VoiceVolumeState>((set) => ({
  volume: loadVolume(),
  keys: loadKeys(),
  setVolume: (raw) => {
    const volume = clampVolume(raw);
    save(VOICE_VOLUME_STORAGE_KEY, String(volume));
    set({ volume });
  },
  setKeys: (keys) => {
    save(VOLUME_KEYS_STORAGE_KEY, keys ? "on" : "off");
    set({ keys });
  },
}));

// One step up or down: a key press, from this page or the desktop shell.
export function stepVolume(direction: 1 | -1) {
  const s = useVoiceVolumeStore.getState();
  s.setVolume(s.volume + direction * VOLUME_STEP);
}
