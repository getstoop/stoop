import { beforeEach, describe, expect, it, vi } from "vitest";

// localStorage stands in, as it does for the cues' switch.
const storage = vi.hoisted(() => {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  });
  return map;
});

import {
  clampVolume,
  DEFAULT_VOLUME,
  gainFor,
  MAX_VOLUME,
  stepVolume,
  useVoiceVolumeStore,
  VOICE_EVEN_OUT_STORAGE_KEY,
  VOICE_VOLUME_STORAGE_KEY,
  VOLUME_KEYS_STORAGE_KEY,
  VOLUME_STEP,
} from "./voiceVolume";

beforeEach(() => {
  storage.clear();
  useVoiceVolumeStore.setState({
    volume: DEFAULT_VOLUME,
    keys: true,
    evenOut: false,
  });
});

// The store reads localStorage once, as the module loads; a fresh copy
// of it is what a reload would see.
async function reloaded() {
  vi.resetModules();
  return (await import("./voiceVolume")).useVoiceVolumeStore.getState();
}

describe("clampVolume", () => {
  it("keeps a whole number between 0 and the ceiling", () => {
    expect(clampVolume(140)).toBe(140);
    expect(clampVolume(-5)).toBe(0);
    expect(clampVolume(999)).toBe(MAX_VOLUME);
    expect(clampVolume(350)).toBe(300);
    expect(clampVolume(33.4)).toBe(33);
    expect(clampVolume("120")).toBe(120);
  });

  it("keeps a value stored before the ceiling rose", () => {
    expect(clampVolume("200")).toBe(200);
  });

  it("reads anything else as the default", () => {
    expect(clampVolume("loud")).toBe(DEFAULT_VOLUME);
    expect(clampVolume("")).toBe(DEFAULT_VOLUME);
    expect(clampVolume(Number.NaN)).toBe(DEFAULT_VOLUME);
    expect(clampVolume(undefined)).toBe(DEFAULT_VOLUME);
  });
});

describe("gainFor", () => {
  it("is 1 as sent, 0 silent and 3 at the ceiling", () => {
    expect(gainFor(100)).toBe(1);
    expect(gainFor(0)).toBe(0);
    expect(gainFor(200)).toBe(2);
    expect(gainFor(300)).toBe(3);
    expect(gainFor(350)).toBe(3);
  });
});

describe("the store", () => {
  it("keeps the volume on this device, clamped", () => {
    useVoiceVolumeStore.getState().setVolume(150);
    expect(useVoiceVolumeStore.getState().volume).toBe(150);
    expect(storage.get(VOICE_VOLUME_STORAGE_KEY)).toBe("150");
    useVoiceVolumeStore.getState().setVolume(500);
    expect(useVoiceVolumeStore.getState().volume).toBe(MAX_VOLUME);
  });

  it("keeps the keys switch on this device", () => {
    useVoiceVolumeStore.getState().setKeys(false);
    expect(useVoiceVolumeStore.getState().keys).toBe(false);
    expect(storage.get(VOLUME_KEYS_STORAGE_KEY)).toBe("off");
  });

  it("keeps the even out switch on this device, off until turned on", async () => {
    expect((await reloaded()).evenOut).toBe(false);
    useVoiceVolumeStore.getState().setEvenOut(true);
    expect(useVoiceVolumeStore.getState().evenOut).toBe(true);
    expect(storage.get(VOICE_EVEN_OUT_STORAGE_KEY)).toBe("on");
    expect((await reloaded()).evenOut).toBe(true);
    useVoiceVolumeStore.getState().setEvenOut(false);
    expect(storage.get(VOICE_EVEN_OUT_STORAGE_KEY)).toBe("off");
    expect((await reloaded()).evenOut).toBe(false);
  });

  it('reads anything but "on" as off', async () => {
    storage.set(VOICE_EVEN_OUT_STORAGE_KEY, "true");
    expect((await reloaded()).evenOut).toBe(false);
  });

  it("resets the volume alone: the switch is not the volume", () => {
    useVoiceVolumeStore.getState().setEvenOut(true);
    useVoiceVolumeStore.getState().setVolume(DEFAULT_VOLUME);
    expect(useVoiceVolumeStore.getState().evenOut).toBe(true);
  });
});

describe("stepVolume", () => {
  it("moves one step and stops at the ends", () => {
    stepVolume(1);
    expect(useVoiceVolumeStore.getState().volume).toBe(
      DEFAULT_VOLUME + VOLUME_STEP,
    );
    stepVolume(-1);
    stepVolume(-1);
    expect(useVoiceVolumeStore.getState().volume).toBe(
      DEFAULT_VOLUME - VOLUME_STEP,
    );
    useVoiceVolumeStore.getState().setVolume(MAX_VOLUME);
    stepVolume(1);
    expect(useVoiceVolumeStore.getState().volume).toBe(MAX_VOLUME);
    useVoiceVolumeStore.getState().setVolume(0);
    stepVolume(-1);
    expect(useVoiceVolumeStore.getState().volume).toBe(0);
  });
});
