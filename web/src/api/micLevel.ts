import { type MicLevelReading, NO_MIC_LEVEL } from "../stores/voice";

// The mic level meter's arithmetic: a loudness from the analyser's
// time-domain samples, a peak that holds and slides down, and the rule
// that calls a mic quiet. voiceLevel.ts feeds it one sample per tick off
// the same analyser as the speaking ring; components/MicLevel draws the
// result. Pure, so the sequences are pinned down in micLevel.test.ts.

export const SEGMENTS = 10;

export const QUIET_HINT =
  "Your mic is quiet. Move closer or turn it up in your system settings.";

// The meter's range, as RMS in dBFS. The browser's gain control brings
// speech to around -20 to -30 dBFS on the published track, so a normal
// voice sits in the upper half and a shout reaches the top; the floor is
// where a room's noise ends and sound begins, and the first segment with
// it, so "something lit, ring dark" is what quiet means.
export const FLOOR_DB = -50;
export const TOP_DB = -10;

// Up fast and down slow: a syllable registers in a sample or two, and the
// fall between words is a slide rather than a flicker. Per-sample factors,
// so they assume the ring's SAMPLE_MS.
const ATTACK = 0.6;
const RELEASE = 0.25;

// The peak segment holds where the voice last reached, then slides to
// meet the level: a full-scale peak takes two seconds to the bottom.
export const PEAK_HOLD_MS = 500;
const PEAK_FALL_PER_MS = 0.5 / 1000;

// Quiet is sustained, not instant: gain control hides a quiet mic for a
// few seconds, so the meter waits for this much sound above the floor that
// never reached the ring's threshold. Only sound counts — silence neither
// adds to the run nor ends it — and a loud sample ends it. A gap longer
// than MAX_STEP_MS is the tab asleep, not sound, so a sample credits at
// most that much.
export const QUIET_AFTER_MS = 4000;
const MAX_STEP_MS = 250;

// Below this a decaying level is written as 0, so a settled meter stops
// changing and the store stops being written.
const SETTLED = 0.001;

export interface MicLevelState extends MicLevelReading {
  // When the last sample was taken; null before the first.
  at: number | null;
  peakAt: number;
  // How long the current run of low-but-present sound has lasted.
  lowMs: number;
}

export const IDLE_MIC_LEVEL: MicLevelState = {
  ...NO_MIC_LEVEL,
  at: null,
  peakAt: 0,
  lowMs: 0,
};

export function rmsOf(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

// An RMS as a position on the meter, 0 at the floor and 1 at the top.
export function loudness(rms: number): number {
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / (TOP_DB - FLOOR_DB)));
}

// One sample: the RMS of the window, whether the ring's reader called it
// loud, and when. `speaking` is the ring's own decision so the two can
// never disagree about where the line is.
export function stepMicLevel(
  prev: MicLevelState,
  rms: number,
  speaking: boolean,
  t: number,
): MicLevelState {
  const dt =
    prev.at === null ? 0 : Math.min(MAX_STEP_MS, Math.max(0, t - prev.at));
  const raw = loudness(rms);
  let level =
    raw >= prev.level
      ? prev.level + (raw - prev.level) * ATTACK
      : prev.level + (raw - prev.level) * RELEASE;
  if (level < SETTLED) level = 0;

  let { peak, peakAt } = prev;
  if (level >= peak) {
    peak = level;
    peakAt = t;
  } else if (t - peakAt >= PEAK_HOLD_MS) {
    peak = Math.max(level, peak - PEAK_FALL_PER_MS * dt);
  }

  let lowMs = prev.lowMs;
  if (speaking) lowMs = 0;
  else if (raw > 0) lowMs += dt;

  return { level, peak, quiet: lowMs >= QUIET_AFTER_MS, at: t, peakAt, lowMs };
}

// How many of the segments a value lights.
export function litSegments(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * SEGMENTS);
}

export function sameReading(a: MicLevelReading, b: MicLevelReading): boolean {
  return a.level === b.level && a.peak === b.peak && a.quiet === b.quiet;
}
