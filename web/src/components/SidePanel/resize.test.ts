import { describe, expect, it } from "vitest";
import { clampSidePanel, MIN_SIDE_PANEL, maxSidePanel } from "./resize";

describe("maxSidePanel", () => {
  it("leaves the page its room", () => {
    expect(maxSidePanel(1440)).toBe(800);
  });
  it("never drops under the floor", () => {
    expect(maxSidePanel(900)).toBe(MIN_SIDE_PANEL);
    expect(maxSidePanel(0)).toBe(MIN_SIDE_PANEL);
  });
});

describe("clampSidePanel", () => {
  it("keeps a width within the floor and the ceiling", () => {
    expect(clampSidePanel(500, 800)).toBe(500);
    expect(clampSidePanel(100, 800)).toBe(MIN_SIDE_PANEL);
    expect(clampSidePanel(5000, 800)).toBe(800);
  });
  it("reads what was saved and rounds it", () => {
    expect(clampSidePanel("512.4", 800)).toBe(512);
  });
  it("treats anything else as unset", () => {
    expect(clampSidePanel(null, 800)).toBeNull();
    expect(clampSidePanel("", 800)).toBeNull();
    expect(clampSidePanel("wide", 800)).toBeNull();
    expect(clampSidePanel(Number.NaN, 800)).toBeNull();
  });
});

describe("clampSidePanel on blank storage", () => {
  it("reads whitespace as unset", () => {
    expect(clampSidePanel("   ", 800)).toBeNull();
  });
});
