import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVoiceStore } from "../stores/voice";

// Two seams stand in for the host: the shell's switch, and Web Audio,
// which is counted rather than heard. The coalescing window is driven
// with fake timers, since a burst is the case that matters and the
// browser suite could only watch one go by.
const seams = vi.hoisted(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
  });
  const started: string[] = [];
  class FakeContext {
    state = "running";
    currentTime = 0;
    destination = {};
    resume = () => Promise.resolve();
    createGain() {
      const gain = {
        setValueAtTime: () => gain,
        linearRampToValueAtTime: () => gain,
        exponentialRampToValueAtTime: () => gain,
      };
      const node = { gain, connect: () => node };
      return node;
    }
    createOscillator() {
      const osc = {
        type: "sine",
        frequency: { setValueAtTime: (hz: number) => started.push(`${hz}`) },
        connect: () => ({ connect: () => undefined }),
        start: () => undefined,
        stop: () => undefined,
      };
      return osc;
    }
  }
  vi.stubGlobal("AudioContext", FakeContext);
  const shell: { value: boolean | undefined } = { value: undefined };
  return { storage, started, shell };
});

vi.mock("./platform", () => ({
  shellVoiceCues: () => seams.shell.value,
}));

import {
  COALESCE_MS,
  cancelCues,
  cue,
  cuesEnabled,
  shouldPlayCue,
  useVoiceCuesStore,
  VOICE_CUES_STORAGE_KEY,
} from "./voiceCues";

// Every note started since the last reset, as its pitch. One cue is two.
const notes = () => seams.started.splice(0);

function connected() {
  useVoiceStore.getState().setConnection({
    spaceId: "s",
    channelId: "c",
    status: "connected",
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  seams.started.length = 0;
  seams.shell.value = undefined;
  seams.storage.clear();
  useVoiceCuesStore.setState({ enabled: true });
  useVoiceStore.setState({
    connection: null,
    deafened: false,
    audioBlocked: false,
  });
});

afterEach(() => {
  cancelCues();
  vi.useRealTimers();
});

describe("shouldPlayCue", () => {
  const on = {
    enabled: true,
    connected: true,
    deafened: false,
    audioBlocked: false,
  };
  it("plays only when every rule holds", () => {
    expect(shouldPlayCue(on)).toBe(true);
    expect(shouldPlayCue({ ...on, enabled: false })).toBe(false);
    expect(shouldPlayCue({ ...on, connected: false })).toBe(false);
    expect(shouldPlayCue({ ...on, deafened: true })).toBe(false);
    expect(shouldPlayCue({ ...on, audioBlocked: true })).toBe(false);
  });
});

describe("cue", () => {
  it("plays the rising pair for a join and the falling pair for a leave", () => {
    connected();
    cue("join");
    vi.advanceTimersByTime(COALESCE_MS);
    expect(notes()).toEqual(["587", "880"]);
    cue("leave");
    vi.advanceTimersByTime(COALESCE_MS);
    expect(notes()).toEqual(["880", "587"]);
  });

  it("collapses a burst of arrivals into one cue", () => {
    connected();
    cue("join");
    cue("join");
    vi.advanceTimersByTime(COALESCE_MS / 2);
    cue("join");
    vi.advanceTimersByTime(COALESCE_MS);
    expect(notes(), "three joins inside the window").toHaveLength(2);
  });

  it("keeps a join and a leave apart", () => {
    connected();
    cue("join");
    cue("leave");
    vi.advanceTimersByTime(COALESCE_MS);
    expect(notes()).toEqual(["587", "880", "880", "587"]);
  });

  it("reads the rules when the window closes, not when it opens", () => {
    connected();
    cue("join");
    useVoiceStore.getState().setDeafened(true);
    vi.advanceTimersByTime(COALESCE_MS);
    expect(notes(), "deafened before the cue landed").toHaveLength(0);
  });

  it("is silent out of a call, while audio is blocked, and when off", () => {
    cue("join");
    vi.advanceTimersByTime(COALESCE_MS);
    expect(notes(), "not connected").toHaveLength(0);

    connected();
    useVoiceStore.getState().setAudioBlocked(true);
    cue("join");
    vi.advanceTimersByTime(COALESCE_MS);
    expect(notes(), "audio blocked").toHaveLength(0);

    useVoiceStore.getState().setAudioBlocked(false);
    useVoiceCuesStore.getState().setEnabled(false);
    cue("join");
    vi.advanceTimersByTime(COALESCE_MS);
    expect(notes(), "switched off").toHaveLength(0);
  });

  it("takes the call as still up when told so, for our own leave", () => {
    // leaveVoice clears the connection before the cue fires.
    cue("leave", { connected: true });
    vi.advanceTimersByTime(COALESCE_MS);
    expect(notes()).toEqual(["880", "587"]);
  });

  it("drops what cancelCues finds queued", () => {
    connected();
    cue("join");
    cancelCues();
    vi.advanceTimersByTime(COALESCE_MS);
    expect(notes()).toHaveLength(0);
  });
});

describe("the switch", () => {
  it("is kept in this browser", () => {
    useVoiceCuesStore.getState().setEnabled(false);
    expect(seams.storage.get(VOICE_CUES_STORAGE_KEY)).toBe("off");
    expect(cuesEnabled()).toBe(false);
    useVoiceCuesStore.getState().setEnabled(true);
    expect(seams.storage.get(VOICE_CUES_STORAGE_KEY)).toBe("on");
    expect(cuesEnabled()).toBe(true);
  });

  it("is the shell's where the shell has one", () => {
    useVoiceCuesStore.getState().setEnabled(true);
    seams.shell.value = false;
    expect(cuesEnabled(), "app switch off beats browser on").toBe(false);
    useVoiceCuesStore.getState().setEnabled(false);
    seams.shell.value = true;
    expect(cuesEnabled(), "app switch on beats browser off").toBe(true);
  });
});
