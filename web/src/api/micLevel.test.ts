import { describe, expect, it } from "vitest";
import {
  FLOOR_DB,
  IDLE_MIC_LEVEL,
  litSegments,
  loudness,
  type MicLevelState,
  PEAK_HOLD_MS,
  QUIET_AFTER_MS,
  rmsOf,
  stepMicLevel,
  TOP_DB,
} from "./micLevel";

// A sample is an RMS and the ring's decision; sequences are fed at the
// ring's 50 ms cadence, the way voiceLevel.ts feeds the real thing.
const STEP = 50;
const dbfs = (db: number) => 10 ** (db / 20);
// Low but present: well above the floor, never near a shout.
const LOW = dbfs(-40);
const LOUD = dbfs(-20);

function feed(
  from: MicLevelState,
  samples: { rms: number; speaking?: boolean }[],
  start = 0,
): MicLevelState {
  let state = from;
  let t = start;
  for (const sample of samples) {
    state = stepMicLevel(state, sample.rms, sample.speaking ?? false, t);
    t += STEP;
  }
  return state;
}

const times = (count: number, sample: { rms: number; speaking?: boolean }) =>
  Array.from({ length: count }, () => sample);

describe("loudness", () => {
  it("maps the dB range onto the meter", () => {
    expect(loudness(0)).toBe(0);
    expect(loudness(dbfs(FLOOR_DB - 10))).toBe(0);
    expect(loudness(dbfs(FLOOR_DB))).toBeCloseTo(0);
    expect(loudness(dbfs((FLOOR_DB + TOP_DB) / 2))).toBeCloseTo(0.5);
    expect(loudness(dbfs(TOP_DB))).toBeCloseTo(1);
    expect(loudness(1)).toBe(1);
  });

  it("takes the RMS of a window", () => {
    expect(rmsOf(new Float32Array(0))).toBe(0);
    expect(rmsOf(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
    expect(rmsOf(new Float32Array([0, 0, 0]))).toBe(0);
  });

  it("rounds a level to segments", () => {
    expect(litSegments(0)).toBe(0);
    expect(litSegments(0.04)).toBe(0);
    expect(litSegments(0.05)).toBe(1);
    expect(litSegments(0.5)).toBe(5);
    expect(litSegments(1)).toBe(10);
    expect(litSegments(1.5)).toBe(10);
  });
});

describe("the level", () => {
  it("rises quickly and falls slowly", () => {
    const up = feed(IDLE_MIC_LEVEL, times(3, { rms: LOUD }));
    expect(up.level).toBeGreaterThan(0.6);
    const down = feed(up, times(3, { rms: 0 }), 150);
    expect(down.level).toBeGreaterThan(0.2);
    expect(down.level).toBeLessThan(up.level);
  });

  it("settles to exactly zero in silence", () => {
    const up = feed(IDLE_MIC_LEVEL, times(3, { rms: LOUD }));
    const down = feed(up, times(60, { rms: 0 }), 150);
    expect(down.level).toBe(0);
    expect(down.peak).toBe(0);
  });
});

describe("the peak", () => {
  it("holds where the voice reached, then slides down to the level", () => {
    const up = feed(IDLE_MIC_LEVEL, times(5, { rms: LOUD }));
    const held = feed(up, times(PEAK_HOLD_MS / STEP - 1, { rms: 0 }), 250);
    expect(held.peak).toBe(up.peak);
    expect(held.level).toBeLessThan(held.peak);
    const later = feed(held, times(10, { rms: 0 }), 250 + PEAK_HOLD_MS);
    expect(later.peak).toBeLessThan(held.peak);
    expect(later.peak).toBeGreaterThanOrEqual(later.level);
    const gone = feed(later, times(60, { rms: 0 }), 250 + PEAK_HOLD_MS + 500);
    expect(gone.peak).toBe(0);
  });

  it("jumps up with a louder sample", () => {
    const low = feed(IDLE_MIC_LEVEL, times(5, { rms: LOW }));
    const loud = feed(low, [{ rms: LOUD, speaking: true }], 250);
    expect(loud.peak).toBeGreaterThan(low.peak);
    expect(loud.peak).toBe(loud.level);
  });
});

describe("the quiet rule", () => {
  const lowSamples = (ms: number) => times(ms / STEP, { rms: LOW });

  it("calls the mic quiet after four seconds of low sound", () => {
    const almost = feed(IDLE_MIC_LEVEL, lowSamples(QUIET_AFTER_MS));
    expect(almost.quiet).toBe(false);
    const quiet = feed(almost, [{ rms: LOW }], QUIET_AFTER_MS);
    expect(quiet.quiet).toBe(true);
  });

  it("is never quiet during silence", () => {
    const silent = feed(IDLE_MIC_LEVEL, times(200, { rms: 0 }));
    expect(silent.quiet).toBe(false);
    expect(silent.lowMs).toBe(0);
  });

  it("lets silence pause the run rather than end it", () => {
    const half = feed(IDLE_MIC_LEVEL, lowSamples(QUIET_AFTER_MS / 2));
    const paused = feed(half, times(40, { rms: 0 }), QUIET_AFTER_MS / 2);
    expect(paused.lowMs).toBe(half.lowMs);
    const quiet = feed(
      paused,
      lowSamples(QUIET_AFTER_MS / 2 + STEP),
      QUIET_AFTER_MS / 2 + 2000,
    );
    expect(quiet.quiet).toBe(true);
  });

  it("clears on a loud sample", () => {
    const quiet = feed(IDLE_MIC_LEVEL, lowSamples(QUIET_AFTER_MS + STEP));
    expect(quiet.quiet).toBe(true);
    const cleared = feed(
      quiet,
      [{ rms: LOUD, speaking: true }],
      QUIET_AFTER_MS + STEP,
    );
    expect(cleared.quiet).toBe(false);
    expect(cleared.lowMs).toBe(0);
  });

  it("starts the run again from a loud sample", () => {
    const run = feed(IDLE_MIC_LEVEL, [
      ...lowSamples(QUIET_AFTER_MS - STEP),
      { rms: LOUD, speaking: true },
      ...lowSamples(QUIET_AFTER_MS - STEP),
    ]);
    expect(run.quiet).toBe(false);
  });

  // The ring's decision is what counts as loud, not the meter's own
  // level: a sample the ring called quiet never ends the run.
  it("takes the ring's word for what is loud", () => {
    const run = feed(IDLE_MIC_LEVEL, [
      ...lowSamples(QUIET_AFTER_MS),
      { rms: LOUD, speaking: false },
    ]);
    expect(run.quiet).toBe(true);
  });

  // A tab asleep delivers no frames; the first sample after it must not
  // count the whole gap as sound.
  it("credits a gap between samples only so far", () => {
    const first = stepMicLevel(IDLE_MIC_LEVEL, LOW, false, 0);
    const after = stepMicLevel(first, LOW, false, 10_000);
    expect(after.lowMs).toBeLessThan(QUIET_AFTER_MS);
    expect(after.quiet).toBe(false);
  });
});
