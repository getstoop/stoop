import { create } from "zustand";
import { useVoiceStore } from "../stores/voice";
import { shellVoiceCues } from "./platform";

// The join and leave cues: a soft two-note tone when the call you are in
// gets bigger or smaller, yourself included. Synthesized with Web Audio
// rather than shipped as files, so there is nothing to load and nothing
// to license; the pair is one rising, one falling, and means one thing.
//
// Whether they play is a choice about this device's speakers, so it is
// kept in localStorage like the theme and never on the server. Inside
// the desktop app the switch is the app's, one for every server it
// holds, and is asked at the moment a cue would play
// (docs/architecture/desktop.md); this browser's key is then ignored.
//
// The source of the cues is the LiveKit room, not the sidebar's presence
// feed: they play only for the call you are connected to. docs/architecture/voice.md.

export type Cue = "join" | "leave";

export const VOICE_CUES_STORAGE_KEY = "stoop.voiceCues";

// A note: frequency in Hz, when it starts and how long it holds, in
// seconds from the cue's start. D5 up to A5 in, A5 down to D5 out.
type Note = [freq: number, start: number, hold: number];
const NOTES: Record<Cue, Note[]> = {
  join: [
    [587, 0, 0.09],
    [880, 0.09, 0.16],
  ],
  leave: [
    [880, 0, 0.09],
    [587, 0.09, 0.16],
  ],
};
// Peak gain: well under a voice at speaking level.
const LEVEL = 0.18;
const ATTACK = 0.006;
const RELEASE = 0.12;

// Arrivals inside this window share one cue. A LiveKit reconnect can
// re-announce a whole room within a few milliseconds, and a drum roll
// is not what happened.
export const COALESCE_MS = 150;

interface VoiceCuesState {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

function load(): boolean {
  try {
    return localStorage.getItem(VOICE_CUES_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export const useVoiceCuesStore = create<VoiceCuesState>((set) => ({
  enabled: load(),
  setEnabled: (enabled) => {
    try {
      localStorage.setItem(VOICE_CUES_STORAGE_KEY, enabled ? "on" : "off");
    } catch {
      // Private mode or storage disabled: the choice lasts for this page.
    }
    set({ enabled });
  },
}));

// Whether cues are on for this page: the shell's switch where there is
// one, otherwise this browser's.
export function cuesEnabled(): boolean {
  return shellVoiceCues() ?? useVoiceCuesStore.getState().enabled;
}

// The one question, answered at the moment a cue would play. Deafened
// holds the cues the way it holds the voices, and a browser still
// waiting on "Enable audio" is not playing anything anyway.
export function shouldPlayCue(s: {
  enabled: boolean;
  connected: boolean;
  deafened: boolean;
  audioBlocked: boolean;
}): boolean {
  return s.enabled && s.connected && !s.deafened && !s.audioBlocked;
}

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = globalThis.AudioContext;
  if (typeof Ctor !== "function") return null;
  ctx = new Ctor();
  return ctx;
}

function synth(cue: Cue) {
  const c = audio();
  if (!c) return;
  // Playback was blocked before a gesture; joining was one, so this
  // usually succeeds. If it does not, the cue is simply not heard.
  if (c.state === "suspended") c.resume().catch(() => {});
  const at = c.currentTime + 0.01;
  for (const [freq, start, hold] of NOTES[cue]) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    const t0 = at + start;
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(LEVEL, t0 + ATTACK);
    gain.gain.setValueAtTime(LEVEL, t0 + Math.max(ATTACK, hold - RELEASE));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + hold + RELEASE);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + hold + RELEASE + 0.02);
  }
}

const pending: Partial<Record<Cue, ReturnType<typeof setTimeout>>> = {};

// Plays a cue, once per window, if the rules above say so. The rules are
// read when the window closes, not when it opens: a leave that arrives
// as the call is torn down should find the call gone and stay quiet.
export function cue(kind: Cue, opts: { connected?: boolean } = {}) {
  if (pending[kind]) return;
  pending[kind] = setTimeout(() => {
    delete pending[kind];
    const v = useVoiceStore.getState();
    if (
      shouldPlayCue({
        enabled: cuesEnabled(),
        connected: opts.connected ?? v.connection?.status === "connected",
        deafened: v.deafened,
        audioBlocked: v.audioBlocked,
      })
    )
      synth(kind);
  }, COALESCE_MS);
}

// Drops anything queued; a torn-down call plays nothing late.
export function cancelCues() {
  for (const kind of Object.keys(pending) as Cue[]) {
    clearTimeout(pending[kind]);
    delete pending[kind];
  }
}

// Plays one for the settings row, past every rule but the switch itself.
export function previewCue(kind: Cue) {
  synth(kind);
}
