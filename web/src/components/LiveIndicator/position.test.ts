import { describe, expect, it } from "vitest";
import { popoverPosition } from "./position";

const pill = { top: 12, left: 12, right: 56, bottom: 56 };

describe("popoverPosition", () => {
  it("opens beside a rail pill, level with its top", () => {
    expect(popoverPosition(pill, "rail", 1200)).toEqual({ top: 12, left: 64 });
  });

  it("opens under a header pill", () => {
    expect(popoverPosition(pill, "header", 1200)).toEqual({
      top: 64,
      left: 12,
    });
  });

  it("keeps clear of the right edge on a phone", () => {
    const near = { top: 8, left: 300, right: 332, bottom: 40 };
    expect(popoverPosition(near, "header", 360).left).toBe(360 - 280 - 8);
  });

  it("keeps clear of the left edge when the window is narrower than it", () => {
    expect(popoverPosition(pill, "header", 200).left).toBe(8);
  });
});
