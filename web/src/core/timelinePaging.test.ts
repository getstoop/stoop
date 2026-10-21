import { describe, expect, it } from "vitest";
import { newerAfter } from "./timelineState";
import {
  deleted,
  edited,
  ids,
  opened,
  paged,
  posted,
  ready,
  run,
  start,
  text,
} from "./timelineTesting";

// Pages either side of a window, and the cap.

describe("a window short of the newest message", () => {
  it("counts a new message rather than showing it", () => {
    const state = run(
      [posted("09"), posted("10")],
      opened(["03", "04"], { hasNewer: true }),
    );
    expect(ids(state)).toEqual(["03", "04"]);
    expect(ready(state).pendingNewer).toBe(2);
  });

  it("shows one at once when it reaches the newest", () => {
    const state = run([posted("05")], opened(["03", "04"]));
    expect(ids(state)).toEqual(["03", "04", "05"]);
    expect(ready(state).pendingNewer).toBe(0);
  });
});

describe("newer pages", () => {
  it("appends the page after the newest message held", () => {
    const shown = opened(["03", "04"], { hasNewer: true });
    expect(newerAfter(shown)).toBe("04");
    const paging = run([start(2, "newer")], shown);
    expect(ready(paging).loadingNewer).toBe(true);
    expect(newerAfter(paging)).toBeNull();
    const state = run([paged(2, ["05", "06"], { hasNewer: true })], paging);
    expect(ids(state)).toEqual(["03", "04", "05", "06"]);
    expect(ready(state).loadingNewer).toBe(false);
    expect(ready(state).page.hasNewer).toBe(true);
  });

  it("replays an edit and a deletion made during the load over the page", () => {
    const state = run(
      [
        start(2, "newer"),
        edited("05", "reworded"),
        deleted("06"),
        paged(2, ["05", "06"], { hasNewer: true }),
      ],
      opened(["03", "04"], { hasNewer: true }),
    );
    expect(ids(state)).toEqual(["03", "04", "05"]);
    expect(text(state, "05")).toBe("reworded");
  });

  it("brings in what arrived meanwhile once it reaches the newest", () => {
    const state = run(
      [start(2, "newer"), posted("07"), paged(2, ["05", "06"])],
      opened(["03", "04"], { hasNewer: true }),
    );
    expect(ids(state)).toEqual(["03", "04", "05", "06", "07"]);
    expect(ready(state).page.hasNewer).toBe(false);
    expect(ready(state).pendingNewer).toBe(0);
  });

  it("keeps counting what arrived while it still stops short", () => {
    const state = run(
      [start(2, "newer"), posted("09"), paged(2, ["05"], { hasNewer: true })],
      opened(["03", "04"], { hasNewer: true }),
    );
    expect(ids(state)).toEqual(["03", "04", "05"]);
    expect(ready(state).pendingNewer).toBe(1);
  });

  it("asks for one page at a time, either way", () => {
    const shown = opened(["03", "04"], { hasNewer: true });
    const paging = run([start(2, "older"), start(3, "newer")], shown);
    expect(paging.requests.map((out) => out.id)).toEqual([2]);
    expect(newerAfter(paging)).toBeNull();
  });
});

describe("the cap", () => {
  it("drops the newest past it for an older page, and stops being live", () => {
    const state = run(
      [start(2, "older"), paged(2, ["01", "02"], {}, 3)],
      opened(["03", "04"]),
    );
    expect(ids(state)).toEqual(["01", "02", "03"]);
    expect(ready(state).page.hasNewer).toBe(true);
    expect(run([posted("05")], state).shown).toMatchObject({
      pendingNewer: 1,
    });
  });

  it("drops the oldest past it for a newer page", () => {
    const state = run(
      [start(2, "newer"), paged(2, ["05", "06"], { hasNewer: true }, 3)],
      opened(["03", "04"], { hasOlder: false, hasNewer: true }),
    );
    expect(ids(state)).toEqual(["04", "05", "06"]);
    expect(ready(state).page.hasOlder).toBe(true);
  });
});
