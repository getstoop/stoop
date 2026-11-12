import { describe, expect, it } from "vitest";
import { DND_OFF, parseSwitch, switchAt, turnedOn } from "./switch";

const NOW = Date.parse("2026-09-15T12:00:00Z");
const HOUR = 60 * 60 * 1000;

describe("turnedOn", () => {
  it("ends a duration that long from now", () => {
    expect(turnedOn("1h", NOW)).toEqual({ on: true, until: NOW + HOUR, duration: "1h" });
    expect(turnedOn("1w", NOW)).toEqual({ on: true, until: NOW + 168 * HOUR, duration: "1w" });
  });

  it("has no end for never expire", () => {
    expect(turnedOn("never", NOW)).toEqual({ on: true, until: null, duration: "never" });
  });
});

describe("switchAt", () => {
  it("reads as it is held until its end, and off from then", () => {
    const held = turnedOn("1h", NOW);
    expect(switchAt(held, NOW + HOUR - 1)).toBe(held);
    expect(switchAt(held, NOW + HOUR)).toBe(DND_OFF);
    expect(switchAt(held, NOW + 2 * HOUR)).toBe(DND_OFF);
  });

  it("stays on with no end, and off when off", () => {
    const held = turnedOn("never", NOW);
    expect(switchAt(held, NOW + 1000 * HOUR)).toBe(held);
    expect(switchAt(DND_OFF, NOW)).toBe(DND_OFF);
  });
});

describe("parseSwitch", () => {
  it("reads back what was saved", () => {
    const held = turnedOn("3h", NOW);
    expect(parseSwitch(JSON.stringify(held))).toEqual(held);
    const never = turnedOn("never", NOW);
    expect(parseSwitch(JSON.stringify(never))).toEqual(never);
    expect(parseSwitch(JSON.stringify(DND_OFF))).toEqual(DND_OFF);
  });

  it("is off for nothing saved and for anything it can't understand", () => {
    expect(parseSwitch(null)).toBe(DND_OFF);
    expect(parseSwitch("")).toBe(DND_OFF);
    expect(parseSwitch("{")).toBe(DND_OFF);
    expect(parseSwitch("null")).toBe(DND_OFF);
    expect(parseSwitch(JSON.stringify({ on: true }))).toBe(DND_OFF);
    expect(parseSwitch(JSON.stringify({ on: true, until: "soon", duration: "1h" }))).toBe(DND_OFF);
    expect(parseSwitch(JSON.stringify({ on: true, until: null, duration: "2h" }))).toBe(DND_OFF);
  });
});
