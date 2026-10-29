import { describe, expect, it } from "vitest";
import { deviceRow } from "./row";

const mic = (label: string, deviceId = label) => ({ deviceId, label });

describe("deviceRow", () => {
  it("names the kind in muted text while nothing is listed", () => {
    expect(deviceRow("audioinput", true, [])).toEqual({
      text: "Microphone",
      placeholder: true,
      opens: false,
    });
    expect(deviceRow("audioinput", false, [])).toEqual({
      text: "Microphone",
      placeholder: true,
      opens: false,
    });
  });

  it("shows one device's name without opening", () => {
    expect(deviceRow("audioinput", true, [mic("Built-in Microphone")])).toEqual(
      { text: "Built-in Microphone", placeholder: false, opens: false },
    );
  });

  it("opens with two or more, naming the active one", () => {
    const row = deviceRow(
      "audioinput",
      true,
      [mic("Built-in Microphone"), mic("Headset")],
      "Headset",
    );
    expect(row).toEqual({ text: "Headset", placeholder: false, opens: true });
  });

  it("falls back to the first device when the active one is unknown", () => {
    const row = deviceRow("audioinput", true, [mic("A"), mic("B")], "gone");
    expect(row.text).toBe("A");
    expect(row.opens).toBe(true);
  });

  it("names the kind for a device the browser has not labelled", () => {
    expect(deviceRow("videoinput", true, [mic("", "x")]).text).toBe("Camera");
  });

  it("says Camera off whatever the list holds while the camera is off", () => {
    expect(
      deviceRow("videoinput", false, [mic("Cam A"), mic("Cam B")]),
    ).toEqual({ text: "Camera off", placeholder: true, opens: false });
  });
});
