import type { LocalAudioTrack } from "livekit-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVoiceStore } from "../stores/voice";
import { stopLocalLevel, syncLocalLevel } from "./voiceLevel";

// Two seams stand in for the browser: LiveKit's analyser and the frame
// clock. The threshold, the hold and the mute rule are the module's own,
// and driving the clock by hand is the only way to pin down a sequence
// the browser suite can only watch go by.
const lk = vi.hoisted(() => {
  const state = { volume: 0, fail: false };
  const cleanup = vi.fn(() => Promise.resolve());
  const createAudioAnalyser = vi.fn(() => {
    if (state.fail) throw new Error("no Web Audio");
    return { calculateVolume: () => state.volume, cleanup };
  });
  return { state, cleanup, createAudioAnalyser };
});

vi.mock("livekit-client", () => ({
  createAudioAnalyser: lk.createAudioAnalyser,
}));

const track = (id: string) =>
  ({ mediaStreamTrack: { id } }) as unknown as LocalAudioTrack;

let pending: FrameRequestCallback | null = null;
let nextFrame = 0;
let cancelled: number[] = [];

// One sampled frame: the mic reads `volume` at timestamp `t`.
const frame = (t: number, volume: number) => {
  lk.state.volume = volume;
  const cb = pending;
  pending = null;
  cb?.(t);
};

const ring = () => useVoiceStore.getState().localSpeaking;

// syncLocalLevel starts the meter behind a dynamic import.
const start = async (t: LocalAudioTrack, userId = "casey") => {
  syncLocalLevel(t, userId);
  await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  pending = null;
  nextFrame = 0;
  cancelled = [];
  lk.state.volume = 0;
  lk.state.fail = false;
  lk.createAudioAnalyser.mockClear();
  lk.cleanup.mockClear();
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
    pending = cb;
    return ++nextFrame;
  };
  globalThis.cancelAnimationFrame = (id: number) => {
    cancelled.push(id);
    pending = null;
  };
  useVoiceStore.setState({ localSpeaking: null, muted: false });
});

afterEach(() => {
  stopLocalLevel();
});

describe("syncLocalLevel", () => {
  it("runs no meter when nothing is published", async () => {
    await start(null as unknown as LocalAudioTrack);
    expect(lk.createAudioAnalyser).not.toHaveBeenCalled();
    expect(pending).toBeNull();
  });

  it("keeps the meter it already has for the same mic", async () => {
    const mic = track("a");
    await start(mic);
    await start(mic);
    expect(lk.createAudioAnalyser).toHaveBeenCalledTimes(1);
    expect(lk.cleanup).not.toHaveBeenCalled();
  });

  it("swaps the meter when the mic changes", async () => {
    await start(track("a"));
    frame(1000, 0.5);
    await start(track("b"));
    expect(lk.createAudioAnalyser).toHaveBeenCalledTimes(2);
    expect(lk.cleanup).toHaveBeenCalledTimes(1);
    expect(ring()).toBeNull();
  });

  it("drops the ring and the meter when the mic goes away", async () => {
    await start(track("a"));
    frame(1000, 0.5);
    expect(ring()).toBe("casey");
    syncLocalLevel(null, "casey");
    expect(ring()).toBeNull();
    expect(lk.cleanup).toHaveBeenCalledTimes(1);
    expect(pending).toBeNull();
  });

  // Without Web Audio the ring still lights from the server's updates, so
  // failing to build the meter must be silent.
  it("gives up quietly where there is no Web Audio", async () => {
    lk.state.fail = true;
    await expect(start(track("a"))).resolves.toBeUndefined();
    expect(ring()).toBeNull();
    expect(pending).toBeNull();
  });
});

describe("the speaking ring", () => {
  beforeEach(async () => {
    await start(track("a"));
  });

  it("stays dark for a quiet room", () => {
    frame(1000, 0.05);
    expect(ring()).toBeNull();
  });

  it("lights at the threshold and names the speaker", () => {
    frame(1000, 0.06);
    expect(ring()).toBe("casey");
  });

  it("holds across the gap between words", () => {
    frame(1000, 0.5);
    frame(1050, 0);
    frame(1250, 0);
    expect(ring()).toBe("casey");
    frame(1300, 0);
    expect(ring()).toBeNull();
  });

  it("starts the hold again on every loud sample", () => {
    frame(1000, 0.5);
    frame(1200, 0.5);
    frame(1450, 0);
    expect(ring()).toBe("casey");
    frame(1500, 0);
    expect(ring()).toBeNull();
  });

  it("ignores frames that arrive inside the sample interval", () => {
    frame(1000, 0.5);
    frame(1310, 0);
    expect(ring()).toBeNull();
    frame(1320, 0.9);
    expect(ring()).toBeNull();
    frame(1360, 0.9);
    expect(ring()).toBe("casey");
  });

  it("pushes only the changes to the store", () => {
    let writes = 0;
    const off = useVoiceStore.subscribe(() => {
      writes++;
    });
    frame(1000, 0.5);
    frame(1050, 0.5);
    frame(1100, 0.5);
    expect(writes).toBe(1);
    frame(1400, 0);
    expect(writes).toBe(2);
    off();
  });

  it("darkens the ring the moment the mic is muted", () => {
    frame(1000, 0.5);
    useVoiceStore.setState({ muted: true });
    frame(1050, 0.9);
    expect(ring()).toBeNull();
  });

  // The hold is dropped, not paused: unmuting mid-hold must not light the
  // ring again off a sample from before the mute.
  it("needs a fresh loud sample after unmuting", () => {
    frame(1000, 0.5);
    useVoiceStore.setState({ muted: true });
    frame(1050, 0.9);
    useVoiceStore.setState({ muted: false });
    frame(1100, 0);
    expect(ring()).toBeNull();
    frame(1150, 0.5);
    expect(ring()).toBe("casey");
  });

  it("stops the loop and the ring on stopLocalLevel", () => {
    frame(1000, 0.5);
    stopLocalLevel();
    expect(ring()).toBeNull();
    expect(cancelled).toHaveLength(1);
    expect(lk.cleanup).toHaveBeenCalledTimes(1);
    frame(1050, 0.9);
    expect(ring()).toBeNull();
  });
});
