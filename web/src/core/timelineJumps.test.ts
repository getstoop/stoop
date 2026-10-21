import { describe, expect, it } from "vitest";
import { olderBefore } from "./timelineState";
import {
  deleted,
  edited,
  ids,
  loaded,
  opened,
  paged,
  posted,
  ready,
  run,
  start,
  text,
} from "./timelineTesting";

// Jumps, refreshes, reconnects and threads.

describe("jumps", () => {
  it("replace the window, and drop a page asked for beside the old one", () => {
    const state = run(
      [
        start(2, "older"),
        start(3, "open"),
        loaded(3, ["20", "21"], { hasNewer: true }),
        paged(2, ["01", "02"]),
      ],
      opened(["05", "06"]),
    );
    expect(ids(state)).toEqual(["20", "21"]);
    expect(ready(state).page.hasNewer).toBe(true);
    expect(ready(state).loadingOlder).toBe(false);
  });

  it("hold back paging while one is out", () => {
    const state = run([start(2, "open")], opened(["05", "06"]));
    expect(olderBefore(state)).toBeNull();
  });

  it("keep what is shown when they fail", () => {
    const state = run(
      [
        start(2, "open", "c1"),
        posted("07"),
        { type: "failed", id: 2, outcome: "failed" },
      ],
      opened(["05", "06"]),
    );
    expect(ids(state)).toEqual(["05", "06", "07"]);
    expect(state.requests).toEqual([]);
  });

  it("count what arrived during one beyond the window it brings", () => {
    const state = run(
      [start(2, "open"), posted("30"), loaded(2, ["10"], { hasNewer: true })],
      opened(["05"]),
    );
    expect(ids(state)).toEqual(["10"]);
    expect(ready(state).pendingNewer).toBe(1);
  });
});

describe("a failed open", () => {
  it("leaves paging possible after a jump that dropped a page", () => {
    const state = run(
      [
        start(2, "older"),
        start(3, "open", "c1"),
        { type: "failed", id: 3, outcome: "failed" },
      ],
      opened(["05", "06"]),
    );
    expect(ready(state).loadingOlder).toBe(false);
    expect(olderBefore(state)).toBe("05");
  });

  it("shows failed when it was for another channel", () => {
    const state = run(
      [start(2, "open", "c2"), { type: "failed", id: 2, outcome: "failed" }],
      opened(["05"]),
    );
    expect(state.shown.state).toBe("failed");
  });

  it("shows failed when it names no channel, as the app's do", () => {
    const state = run(
      [start(2, "open"), { type: "failed", id: 2, outcome: "failed" }],
      opened(["05"]),
    );
    expect(state.shown.state).toBe("failed");
  });
});

describe("refreshing", () => {
  it("redraws what is held without dropping a page that is out", () => {
    const state = run(
      [
        start(2, "older"),
        start(3, "refresh"),
        edited("05", "reworded"),
        loaded(3, ["05", "06"]),
        paged(2, ["03", "04"]),
      ],
      opened(["05", "06"]),
    );
    expect(ids(state)).toEqual(["03", "04", "05", "06"]);
    expect(text(state, "05")).toBe("reworded");
  });

  it("waits for a jump on its way", () => {
    const state = run(
      [start(2, "open"), start(3, "refresh")],
      opened(["05", "06"]),
    );
    expect(state.requests.map((out) => out.id)).toEqual([2]);
  });

  it("doesn't wait for a jump asked for before a reconnect", () => {
    const state = run(
      [
        start(2, "open", "c1"),
        { type: "reconnected" },
        start(3, "refresh"),
        loaded(2, ["20"], { hasNewer: true }),
        loaded(3, ["05", "06", "07"]),
      ],
      opened(["05", "06"]),
    );
    expect(ids(state)).toEqual(["05", "06", "07"]);
    expect(state.requests).toEqual([]);
  });

  it("clears the count once it reaches the newest message", () => {
    const counted = run(
      [start(2, "older"), paged(2, ["01", "02"], {}, 3), posted("05")],
      opened(["03", "04"]),
    );
    expect(ready(counted).pendingNewer).toBe(1);
    const state = run(
      [start(3, "refresh"), loaded(3, ["03", "04", "05"])],
      counted,
    );
    expect(ready(state).pendingNewer).toBe(0);
    expect(ready(state).page.hasNewer).toBeFalsy();
  });

  it("gives way to a catch-up, and a catch-up to it", () => {
    const caught = run(
      [start(2, "refresh"), start(3, "catchUp"), loaded(2, ["05", "06", "07"])],
      opened(["05", "06"]),
    );
    expect(ids(caught)).toEqual(["05", "06"]);
    expect(caught.requests.map((out) => out.id)).toEqual([3]);
    const refreshed = run(
      [start(4, "refresh"), loaded(3, ["05", "06", "08"])],
      caught,
    );
    expect(ids(refreshed)).toEqual(["05", "06"]);
    expect(ids(run([loaded(4, ["05", "06", "09"])], refreshed))).toEqual([
      "05",
      "06",
      "09",
    ]);
  });

  it("lets only the latest count", () => {
    const state = run(
      [start(2, "refresh"), start(3, "refresh"), loaded(2, ["05", "06", "07"])],
      opened(["05", "06"]),
    );
    expect(ids(state)).toEqual(["05", "06"]);
  });
});

describe("a reconnect apart from its catch-up", () => {
  it("drops a page asked for before it", () => {
    const state = run(
      [start(2, "older"), { type: "reconnected" }, paged(2, ["01", "02"])],
      opened(["05", "06"]),
    );
    expect(ids(state)).toEqual(["05", "06"]);
    expect(ready(state).loadingOlder).toBe(false);
    expect(olderBefore(state)).toBe("05");
  });

  it("keeps a page asked for after it", () => {
    const state = run(
      [{ type: "reconnected" }, start(2, "older"), paged(2, ["01", "02"])],
      opened(["05", "06"]),
    );
    expect(ids(state)).toEqual(["01", "02", "05", "06"]);
  });
});

describe("a thread's timeline", () => {
  const thread = () => opened(["r1", "r2"], { rootId: "root" });

  it("takes its own replies and nothing else", () => {
    const state = run(
      [
        posted("r3", { threadRootId: "root" }),
        posted("x1", { threadRootId: "other" }),
        posted("c1"),
      ],
      thread(),
    );
    expect(ids(state)).toEqual(["r1", "r2", "r3"]);
  });

  it("replays its own replies over an answer", () => {
    const state = run([
      start(1, "open"),
      posted("r3", { threadRootId: "root" }),
      posted("c1"),
      loaded(1, ["r1", "r2"], { rootId: "root" }),
    ]);
    expect(ids(state)).toEqual(["r1", "r2", "r3"]);
  });

  it("is gone when its root is", () => {
    const state = run([deleted("root")], thread());
    expect(state.shown.state).toBe("gone");
  });
});
