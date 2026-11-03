import { describe, expect, it, vi } from "vitest";
import { markDue, readShown, type Shown } from "./readPass";

describe("markDue", () => {
  it("is due for a row past the marker that this screen has not marked", () => {
    expect(markDue("5", "4", "")).toBe(true);
    expect(markDue("6", "4", "5")).toBe(true);
  });

  it("is not due with the marker there, or once marked", () => {
    expect(markDue("5", "5", "")).toBe(false);
    expect(markDue("5", "4", "5")).toBe(false);
  });
});

// A screen's passes in order, over the same memory and a fake move. The
// marker in `readTo` stays put, as a header does between events.
function reader() {
  const memory = { marked: { current: "" } };
  const moveMarker = vi.fn<() => Promise<unknown>>(async () => {});
  const pass = (shown: Partial<Shown>) =>
    readShown(memory, { loaded: true, newestId: "5", readTo: "5", onScreen: true, hasNewer: false, ...shown }, moveMarker);
  return { memory, moveMarker, pass };
}

describe("readShown", () => {
  it("moves the marker for each live row", async () => {
    const { pass, moveMarker } = reader();
    await pass({ newestId: "6" });
    await pass({ newestId: "7" });
    expect(moveMarker).toHaveBeenCalledTimes(2);
  });

  it("does nothing on a rerun with nothing new", async () => {
    const { pass, moveMarker } = reader();
    await pass({});
    expect(moveMarker).not.toHaveBeenCalled();
  });

  it("moves the marker once for a row, however many passes see it", async () => {
    const { pass, moveMarker } = reader();
    await pass({ newestId: "6" });
    await pass({ newestId: "6" });
    expect(moveMarker).toHaveBeenCalledTimes(1);
  });

  it("asks for nothing until it is loaded, off screen, or short of the newest message", async () => {
    const { pass, moveMarker } = reader();
    await pass({ loaded: false, readTo: "", newestId: "6" });
    await pass({ onScreen: false, newestId: "6" });
    await pass({ hasNewer: true, newestId: "6" });
    expect(moveMarker).not.toHaveBeenCalled();
  });

  it("can move the marker again after a failure", async () => {
    const { pass, moveMarker, memory } = reader();
    moveMarker.mockRejectedValueOnce(new Error("refused"));
    await pass({ newestId: "6" });
    expect(memory.marked.current).toBe("");
    await pass({ newestId: "6" });
    expect(moveMarker).toHaveBeenCalledTimes(2);
  });

  it("keeps two passes in flight apart: a late failure leaves the newer marker", async () => {
    const { pass, moveMarker, memory } = reader();
    moveMarker.mockRejectedValueOnce(new Error("refused")).mockResolvedValueOnce(undefined);
    const first = pass({ newestId: "6" });
    const second = pass({ newestId: "7" });
    await second;
    await first;
    expect(moveMarker).toHaveBeenCalledTimes(2);
    expect(memory.marked.current).toBe("7");
  });
});
