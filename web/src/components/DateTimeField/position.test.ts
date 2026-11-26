import { describe, expect, it } from "vitest";
import { panelPosition } from "./position";

const panel = { width: 392, height: 340 };
const view = { width: 1200, height: 800 };

describe("panelPosition", () => {
  it("opens under the field", () => {
    const field = { top: 100, bottom: 140, left: 300 };
    expect(panelPosition(field, panel, view)).toEqual({ top: 144, left: 300 });
  });

  it("opens above when the window's bottom is close", () => {
    const field = { top: 600, bottom: 640, left: 300 };
    expect(panelPosition(field, panel, view)).toEqual({ top: 256, left: 300 });
  });

  it("stays on screen when neither side has room", () => {
    const short = { width: 1200, height: 420 };
    const field = { top: 200, bottom: 240, left: 300 };
    expect(panelPosition(field, panel, short)).toEqual({ top: 72, left: 300 });
    const tiny = { width: 1200, height: 300 };
    expect(panelPosition(field, panel, tiny).top).toBe(8);
  });

  it("keeps off the right edge", () => {
    const field = { top: 100, bottom: 140, left: 1000 };
    expect(panelPosition(field, panel, view).left).toBe(800);
  });
});
