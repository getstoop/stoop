import { describe, expect, it } from "vitest";
import type { VoiceConnection } from "../stores/voice";
import {
  type CaptureInput,
  captureLabel,
  captureState,
  isCapturing,
  tabTitle,
  voiceReport,
} from "./capture";

const conn = (status: VoiceConnection["status"]): VoiceConnection => ({
  spaceId: "s1",
  channelId: "c1",
  status,
});

const input = (over: Partial<CaptureInput> = {}): CaptureInput => ({
  connection: conn("connected"),
  muted: false,
  cameraOn: false,
  screenOn: false,
  ...over,
});

describe("captureState", () => {
  it("is none outside voice, whatever the flags say", () => {
    const c = captureState(
      input({ connection: null, cameraOn: true, screenOn: true }),
    );
    expect(c).toEqual({
      kind: "none",
      mic: false,
      camera: false,
      screen: false,
    });
  });

  // Nothing is published until the room connects.
  it("captures nothing while joining", () => {
    const c = captureState(input({ connection: conn("connecting") }));
    expect(c.kind).toBe("joining");
    expect(isCapturing(c)).toBe(false);
  });

  it("captures nothing after a failed join", () => {
    const c = captureState(
      input({ connection: conn("error"), screenOn: true }),
    );
    expect(c.kind).toBe("error");
    expect(isCapturing(c)).toBe(false);
  });

  it("reads a muted mic as connected, not capturing", () => {
    const c = captureState(input({ muted: true }));
    expect(c.kind).toBe("muted");
    expect(isCapturing(c)).toBe(false);
  });

  it("reads an open mic as live", () => {
    const c = captureState(input());
    expect(c.kind).toBe("mic");
    expect(isCapturing(c)).toBe(true);
  });

  it("lets the camera outrank the mic, and keeps the mic's state", () => {
    expect(captureState(input({ cameraOn: true }))).toEqual({
      kind: "camera",
      mic: true,
      camera: true,
      screen: false,
    });
    expect(captureState(input({ cameraOn: true, muted: true })).mic).toBe(
      false,
    );
  });

  it("lets a screen share outrank everything", () => {
    const c = captureState(
      input({ cameraOn: true, screenOn: true, muted: true }),
    );
    expect(c.kind).toBe("screen");
    expect(c.camera).toBe(true);
    expect(isCapturing(c)).toBe(true);
  });

  // Muted with the camera on is still capturing: the tab keeps its dot.
  it("counts a camera with a muted mic as capturing", () => {
    expect(
      isCapturing(captureState(input({ cameraOn: true, muted: true }))),
    ).toBe(true);
  });
});

describe("captureLabel", () => {
  it("names every kind, and nothing outside voice", () => {
    expect(captureLabel(captureState(input({ connection: null })))).toBe("");
    expect(captureLabel(captureState(input({ muted: true })))).toBe(
      "In voice, muted",
    );
    expect(captureLabel(captureState(input({ screenOn: true })))).toBe(
      "Sharing your screen",
    );
  });
});

describe("voiceReport", () => {
  // null is what tells the shell to clear the strip.
  it("is null outside voice", () => {
    expect(
      voiceReport(
        captureState(input({ connection: null })),
        "standup",
        "Work",
        false,
      ),
    ).toBeNull();
  });

  it("carries the state and the names", () => {
    expect(
      voiceReport(
        captureState(input({ cameraOn: true })),
        "standup",
        "Work",
        false,
      ),
    ).toEqual({
      kind: "camera",
      mic: true,
      camera: true,
      screen: false,
      deafened: false,
      channel: "standup",
      space: "Work",
    });
  });

  it("stands in an ellipsis for a name still loading", () => {
    const r = voiceReport(captureState(input()), undefined, "", true);
    expect(r?.channel).toBe("…");
    expect(r?.space).toBe("…");
    expect(r?.deafened).toBe(true);
  });
});

describe("tabTitle", () => {
  it("puts a dot ahead of the title only while capturing", () => {
    expect(tabTitle("The Stoop", captureState(input()))).toBe("● The Stoop");
    expect(tabTitle("The Stoop", captureState(input({ muted: true })))).toBe(
      "The Stoop",
    );
    expect(
      tabTitle("The Stoop", captureState(input({ connection: null }))),
    ).toBe("The Stoop");
  });
});
