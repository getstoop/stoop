import { describe, expect, it } from "vitest";
import { readPass } from "./readPass";

describe("readPass", () => {
  it("reads the activity and moves the marker on first coming to a new row", () => {
    expect(readPass("5", "4", "", false, false)).toEqual({ moveMarker: true, readActivity: true });
  });

  it("reads the activity alone with the marker already there", () => {
    expect(readPass("5", "5", "", false, false)).toEqual({ moveMarker: false, readActivity: true });
    expect(readPass("5", "4", "5", false, false)).toEqual({ moveMarker: false, readActivity: true });
  });

  it("only moves the marker for a new row once it has looked", () => {
    expect(readPass("6", "5", "", true, false)).toEqual({ moveMarker: true, readActivity: false });
  });

  it("does nothing once it has looked with the marker there", () => {
    expect(readPass("5", "5", "", true, false)).toBeNull();
    expect(readPass("5", "4", "5", true, false)).toBeNull();
  });

  it("reads with each new row while a catch-up is owed, which never counts as having looked", () => {
    expect(readPass("6", "5", "", false, true)).toEqual({ moveMarker: true, readActivity: true });
  });

  it("waits for a catch-up with nothing new to mark, then reads", () => {
    expect(readPass("5", "5", "", false, true)).toBeNull();
    expect(readPass("5", "5", "", false, false)).toEqual({ moveMarker: false, readActivity: true });
  });
});
