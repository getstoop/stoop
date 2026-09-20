import { describe, expect, it } from "vitest";
import { formatDuration } from "./format";

describe("formatDuration", () => {
  it("keeps one decimal under 10 ms", () => {
    expect(formatDuration(0)).toBe("0 ms");
    expect(formatDuration(400)).toBe("0.4 ms");
    expect(formatDuration(6000)).toBe("6 ms");
    expect(formatDuration(6400)).toBe("6.4 ms");
    expect(formatDuration(9960)).toBe("10 ms");
  });

  it("rounds whole milliseconds up to a second", () => {
    expect(formatDuration(48_400)).toBe("48 ms");
    expect(formatDuration(999_400)).toBe("999 ms");
  });

  it("switches to seconds with one decimal, then whole", () => {
    expect(formatDuration(1_000_000)).toBe("1 s");
    expect(formatDuration(1_200_000)).toBe("1.2 s");
    expect(formatDuration(12_300_000)).toBe("12 s");
  });

  it("never goes negative", () => {
    expect(formatDuration(-5)).toBe("0 ms");
  });
});
