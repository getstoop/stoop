import type { LocalAudioTrack } from "livekit-client";
import { useVoiceStore } from "../stores/voice";
import {
  IDLE_MIC_LEVEL,
  type MicLevelState,
  rmsOf,
  sameReading,
  stepMicLevel,
} from "./micLevel";

// Our own speaking ring, measured from the local mic. LiveKit computes
// ActiveSpeakersChanged on the server, so our own ring would otherwise
// wait for a round trip plus the observer's smoothing window.
//
// The mic level meter is a second reading of the same analyser, taken on
// the same tick: the ring averages FFT magnitudes against one threshold
// for a yes/no, the meter takes an RMS over the time-domain window for a
// loudness (micLevel.ts). One meter, two readings, so they can never
// disagree about what is being heard. Both read the published track,
// after the browser's gain control, so the meter shows what others hear.
//
// Remote rings still come from that event, and still carry that lag: the
// same meter could run on subscribed remote audio (STOOP-122), which
// would light a ring exactly when their voice reaches the speakers.

// Tuned for a normal mic: a quiet room stays under SPEAKING, and HOLD_MS
// carries the ring across the gaps between words.
const SAMPLE_MS = 50;
const SPEAKING = 0.06;
const HOLD_MS = 300;

let sourceTrack: MediaStreamTrack | null = null;
let stop: (() => void) | null = null;
let generation = 0;

// Point the meter at the mic we publish now, or at nothing when there is
// none. Cheap to call again with the same track.
export function syncLocalLevel(track: LocalAudioTrack | null, userId: string) {
  if (track && track.mediaStreamTrack === sourceTrack) return;
  stopLocalLevel();
  if (track) run(track, userId);
}

export function stopLocalLevel() {
  generation++;
  stop?.();
  stop = null;
  sourceTrack = null;
}

async function run(track: LocalAudioTrack, userId: string) {
  const gen = ++generation;
  // Already in the browser's module cache — joinVoice loaded it.
  const { createAudioAnalyser } = await import("livekit-client");
  if (gen !== generation) return;

  let meter: ReturnType<typeof createAudioAnalyser>;
  try {
    meter = createAudioAnalyser(track, {
      fftSize: 512,
      // Less smoothing than the 0.8 default: the ring should follow the
      // voice, and HOLD_MS does the steadying.
      smoothingTimeConstant: 0.4,
      minDecibels: -80,
      maxDecibels: -25,
    });
  } catch {
    return; // No Web Audio here; the server's updates still light the ring.
  }
  sourceTrack = track.mediaStreamTrack;

  let frame = 0;
  let sampled = 0;
  let loud = -Infinity;
  let on = false;
  const show = (speaking: boolean) => {
    if (speaking === on) return;
    on = speaking;
    useVoiceStore.getState().setLocalSpeaking(speaking ? userId : null);
  };

  // The meter's state, and the store written only when what it shows
  // changes: a settled meter costs nothing.
  const samples = new Float32Array(meter.analyser.fftSize);
  let level: MicLevelState = IDLE_MIC_LEVEL;
  const measure = (next: MicLevelState) => {
    const shown = useVoiceStore.getState().micLevel;
    level = next;
    if (sameReading(shown, next)) return;
    useVoiceStore
      .getState()
      .setMicLevel({ level: next.level, peak: next.peak, quiet: next.quiet });
  };

  const tick = (t: number) => {
    frame = requestAnimationFrame(tick);
    if (t - sampled < SAMPLE_MS) return;
    sampled = t;
    if (useVoiceStore.getState().muted) {
      loud = -Infinity;
      show(false);
      measure(IDLE_MIC_LEVEL);
      return;
    }
    const speaking = meter.calculateVolume() >= SPEAKING;
    if (speaking) loud = t;
    show(t - loud < HOLD_MS);
    meter.analyser.getFloatTimeDomainData(samples);
    measure(stepMicLevel(level, rmsOf(samples), speaking, t));
  };
  frame = requestAnimationFrame(tick);

  stop = () => {
    cancelAnimationFrame(frame);
    show(false);
    measure(IDLE_MIC_LEVEL);
    meter.cleanup().catch(() => {});
  };
}
