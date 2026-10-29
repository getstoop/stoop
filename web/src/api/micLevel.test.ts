import { describe, expect, it } from "vitest";
import {
  FLOOR_DB,
  IDLE_MIC_LEVEL,
  LOUD_WITHIN_MS,
  litSegments,
  loudness,
  type MicLevelState,
  PAUSE_MS,
  PEAK_HOLD_MS,
  QUIET_AFTER_MS,
  QUIET_CLEAR_MS,
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
  // The level the run counts is the smoothed one, which takes a few
  // samples to fall under the first segment, so a silence that must end
  // or clear something is fed a little longer than its constant.
  const silence = (ms: number) => times(ms / STEP + 10, { rms: 0 });

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

  it("lets a pause between words hold the run rather than end it", () => {
    const half = feed(IDLE_MIC_LEVEL, lowSamples(QUIET_AFTER_MS / 2));
    const pause = times(PAUSE_MS / STEP, { rms: 0 });
    const paused = feed(half, pause, QUIET_AFTER_MS / 2);
    // The release lights a segment for a few samples more, so the run
    // may have grown; it must not have been reset.
    expect(paused.lowMs).toBeGreaterThanOrEqual(half.lowMs);
    const quiet = feed(
      paused,
      lowSamples(QUIET_AFTER_MS / 2 + STEP),
      QUIET_AFTER_MS / 2 + PAUSE_MS,
    );
    expect(quiet.quiet).toBe(true);
  });

  it("ends the run on a long silence", () => {
    const some = feed(IDLE_MIC_LEVEL, lowSamples(QUIET_AFTER_MS / 2));
    expect(some.lowMs).toBeGreaterThan(0);
    const ended = feed(some, silence(PAUSE_MS), QUIET_AFTER_MS / 2);
    expect(ended.lowMs).toBe(0);
    expect(ended.quiet).toBe(false);
    const later = feed(ended, lowSamples(QUIET_AFTER_MS / 2), 10_000);
    expect(later.quiet).toBe(false);
  });

  // Once amber, the row stays amber across pauses and the other side's
  // turn, long enough to read and hover the hint.
  it("keeps amber through a pause in the talking", () => {
    const quiet = feed(IDLE_MIC_LEVEL, lowSamples(QUIET_AFTER_MS + STEP));
    expect(quiet.quiet).toBe(true);
    const paused = feed(quiet, times(80, { rms: 0 }), QUIET_AFTER_MS + STEP);
    expect(paused.quiet).toBe(true);
    expect(paused.lowMs).toBe(0);
  });

  it("clears amber once the talking has stopped for a while", () => {
    const quiet = feed(IDLE_MIC_LEVEL, lowSamples(QUIET_AFTER_MS + STEP));
    const gone = feed(quiet, silence(QUIET_CLEAR_MS), QUIET_AFTER_MS + STEP);
    expect(gone.quiet).toBe(false);
  });

  // The run counts the level the segments show, not the raw window: a
  // segment lit by the release still counts, nothing lit never does.
  it("never calls a mic quiet with nothing lit", () => {
    let state = IDLE_MIC_LEVEL;
    let t = 0;
    for (; t < QUIET_AFTER_MS * 2; t += STEP) {
      state = stepMicLevel(state, t % 400 < 200 ? LOW : 0, false, t);
      if (state.quiet) break;
    }
    expect(state.quiet).toBe(true);
    expect(litSegments(state.level)).toBeGreaterThanOrEqual(1);
  });

  // An open mic in a room: breathing, a chair, gain control lifting the
  // floor. Above the floor, under the first segment, never a voice.
  it("does not count sound under the first segment", () => {
    const faint = dbfs(FLOOR_DB + 1);
    expect(loudness(faint)).toBeGreaterThan(0);
    expect(litSegments(loudness(faint))).toBe(0);
    const run = feed(IDLE_MIC_LEVEL, times(400, { rms: faint }));
    expect(run.lowMs).toBe(0);
    expect(run.quiet).toBe(false);
  });

  it("clears on loud samples the ring would hold", () => {
    const quiet = feed(IDLE_MIC_LEVEL, lowSamples(QUIET_AFTER_MS + STEP));
    expect(quiet.quiet).toBe(true);
    const cleared = feed(
      quiet,
      times(2, { rms: LOUD, speaking: true }),
      QUIET_AFTER_MS + STEP,
    );
    expect(cleared.quiet).toBe(false);
    expect(cleared.lowMs).toBe(0);
  });

  // A voice hovering at the ring's threshold lights it for one sample now
  // and then; that must not blink the row between amber and green.
  it("keeps amber through a lone loud sample", () => {
    const quiet = feed(IDLE_MIC_LEVEL, lowSamples(QUIET_AFTER_MS + STEP));
    const start = QUIET_AFTER_MS + STEP;
    const lone = feed(quiet, [{ rms: LOUD, speaking: true }], start);
    expect(lone.quiet).toBe(true);
    const apart = feed(
      lone,
      [...lowSamples(LOUD_WITHIN_MS), { rms: LOUD, speaking: true }],
      start + STEP,
    );
    expect(apart.quiet).toBe(true);
  });

  it("starts the run again from held loud samples", () => {
    const run = feed(IDLE_MIC_LEVEL, [
      ...lowSamples(QUIET_AFTER_MS - STEP),
      ...times(2, { rms: LOUD, speaking: true }),
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
