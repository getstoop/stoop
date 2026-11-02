import { describe, expect, it, vi } from "vitest";
import { type ReadRequests, readArrived, readPass, readShown, type Shown } from "./readPass";

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

// A screen's passes in order, over the same memory and fake requests. The
// marker in `readTo` stays put, as a header does between events: `marked`
// is what stops a row being marked twice.
function reader() {
  const memory = { looked: { current: false }, marked: { current: "" } };
  const requests = {
    readActivity: vi.fn<ReadRequests["readActivity"]>(async () => 0),
    moveMarker: vi.fn<ReadRequests["moveMarker"]>(async () => {}),
  };
  const pass = (shown: Partial<Shown>) =>
    readShown(
      memory,
      { loaded: true, newestId: "5", readTo: "5", onScreen: true, hasNewer: false, owing: false, ...shown },
      requests,
    );
  return { memory, requests, pass };
}

// A reader that has come on screen and read the feed once.
async function settled() {
  const made = reader();
  await made.pass({});
  expect(made.requests.readActivity).toHaveBeenCalledTimes(1);
  made.requests.readActivity.mockClear();
  return made;
}

describe("readShown", () => {
  it("moves the marker for each live row, with no feed read", async () => {
    const { pass, requests } = await settled();
    await pass({ newestId: "6" });
    await pass({ newestId: "7" });
    expect(requests.readActivity).not.toHaveBeenCalled();
    expect(requests.moveMarker).toHaveBeenCalledTimes(2);
  });

  it("does nothing on a rerun with nothing new", async () => {
    const { pass, requests } = await settled();
    await pass({});
    expect(requests.readActivity).not.toHaveBeenCalled();
    expect(requests.moveMarker).not.toHaveBeenCalled();
  });

  it("reads the feed again on coming back on screen", async () => {
    const { pass, requests } = await settled();
    await pass({ onScreen: false });
    expect(requests.readActivity).not.toHaveBeenCalled();
    await pass({});
    expect(requests.readActivity).toHaveBeenCalledTimes(1);
  });

  it("reads nothing while the range stops short of the newest, and the feed on the way back", async () => {
    const { pass, requests } = await settled();
    await pass({ hasNewer: true, newestId: "3" });
    expect(requests.readActivity).not.toHaveBeenCalled();
    expect(requests.moveMarker).not.toHaveBeenCalled();
    await pass({});
    expect(requests.readActivity).toHaveBeenCalledTimes(1);
  });

  it("reads the feed when a catch-up lands, even one that brought no row", async () => {
    const { pass, requests } = await settled();
    await pass({ owing: true });
    expect(requests.readActivity).not.toHaveBeenCalled();
    await pass({});
    expect(requests.readActivity).toHaveBeenCalledTimes(1);
  });

  it("reads the feed with each row while a catch-up is owed, and again when it lands", async () => {
    const { pass, requests } = await settled();
    await pass({ owing: true, newestId: "6" });
    await pass({ owing: true, newestId: "7" });
    expect(requests.readActivity).toHaveBeenCalledTimes(2);
    await pass({ newestId: "7" });
    expect(requests.readActivity).toHaveBeenCalledTimes(3);
  });

  it("forgets what it looked at even before anything is loaded", async () => {
    const { pass, requests } = await settled();
    await pass({ loaded: false, owing: true });
    await pass({});
    expect(requests.readActivity).toHaveBeenCalledTimes(1);
  });

  it("moves the marker once for a row, however many passes see it", async () => {
    const { pass, requests } = await settled();
    await pass({ newestId: "6" });
    await pass({ newestId: "6" });
    expect(requests.moveMarker).toHaveBeenCalledTimes(1);
  });

  it("asks for nothing until it is loaded", async () => {
    const { pass, requests } = reader();
    await pass({ loaded: false, readTo: "", newestId: "6" });
    expect(requests.readActivity).not.toHaveBeenCalled();
    expect(requests.moveMarker).not.toHaveBeenCalled();
  });

  it("keeps two passes in flight apart: one feed read, and a late failure leaves the newer marker", async () => {
    const { pass, requests, memory } = reader();
    let answer = (_count: number) => {};
    requests.readActivity.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    // The second pass has no feed read to wait for, so its marker goes first.
    requests.moveMarker.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("refused"));
    const first = pass({ newestId: "6" });
    const second = pass({ newestId: "7" });
    expect(requests.readActivity).toHaveBeenCalledTimes(1);
    await second;
    answer(0);
    await first;
    expect(requests.moveMarker).toHaveBeenCalledTimes(2);
    expect(memory.marked.current).toBe("7");
  });

  it("reads the feed on the next pass after one that failed, and still moves the marker", async () => {
    const { pass, requests } = reader();
    requests.readActivity.mockRejectedValueOnce(new Error("refused"));
    await pass({ newestId: "6" });
    expect(requests.moveMarker).toHaveBeenCalledTimes(1);
    requests.readActivity.mockClear();
    await pass({ newestId: "7" });
    expect(requests.readActivity).toHaveBeenCalledTimes(1);
  });

  it("moves the marker when the feed read found something, with none of its own to move", async () => {
    const { pass, requests } = reader();
    requests.readActivity.mockResolvedValueOnce(2);
    await pass({});
    expect(requests.moveMarker).toHaveBeenCalledTimes(1);
  });

  it("leaves the marker alone when the feed read found nothing and none is due", async () => {
    const { pass, requests } = reader();
    await pass({});
    expect(requests.moveMarker).not.toHaveBeenCalled();
  });

  it("can move the marker again after a failure", async () => {
    const { pass, requests, memory } = await settled();
    requests.moveMarker.mockRejectedValueOnce(new Error("refused"));
    await pass({ newestId: "6" });
    expect(memory.marked.current).toBe("");
    await pass({ newestId: "6" });
    expect(requests.moveMarker).toHaveBeenCalledTimes(2);
  });
});

describe("readArrived", () => {
  it("lets the next pass read the feed after a failed read", async () => {
    const { pass, requests, memory } = await settled();
    await readArrived(memory.looked, () => Promise.reject(new Error("refused")));
    await pass({});
    expect(requests.readActivity).toHaveBeenCalledTimes(1);
  });

  it("leaves the next pass alone after a read that worked", async () => {
    const { pass, requests, memory } = await settled();
    await readArrived(memory.looked, () => Promise.resolve());
    await pass({});
    expect(requests.readActivity).not.toHaveBeenCalled();
  });
});
