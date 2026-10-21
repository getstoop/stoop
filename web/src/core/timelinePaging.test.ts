import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { type Message, MessageSchema } from "../gen/stoop/chat/v1/message_pb";
import {
  type ServerEvent,
  ServerEventSchema,
} from "../gen/stoop/realtime/v1/realtime_pb";
import {
  initialTimeline,
  newerAfter,
  olderBefore,
  type RequestKind,
  type Timeline,
  type TimelineAction,
  timelineReducer,
} from "./timelineState";

// The timeline as web runs it: no header, windows that may stop short of
// the newest message, pages either way under a cap, jumps, refreshes and
// threads.

type State = Timeline<undefined>;
type Action = TimelineAction<undefined>;

const message = (
  id: string,
  init: MessageInitShape<typeof MessageSchema> = {},
): Message =>
  create(MessageSchema, { id, channelId: "c1", content: id, ...init });

const event = (
  payload: MessageInitShape<typeof ServerEventSchema>["payload"],
): ServerEvent => create(ServerEventSchema, { payload });

const page = (ids: string[], hasOlder = true, hasNewer = false) => ({
  messages: ids.map((one) => message(one)),
  hasOlder,
  hasNewer,
});

const loaded = (
  id: number,
  ids: string[],
  edges: { hasOlder?: boolean; hasNewer?: boolean; rootId?: string } = {},
): Action => ({
  type: "loaded",
  id,
  channelId: "c1",
  rootId: edges.rootId,
  page: page(ids, edges.hasOlder ?? true, edges.hasNewer ?? false),
  header: undefined,
  newAfter: null,
});

const paged = (
  id: number,
  ids: string[],
  edges: { hasOlder?: boolean; hasNewer?: boolean } = {},
  cap?: number,
): Action => ({
  type: "paged",
  id,
  page: page(ids, edges.hasOlder ?? true, edges.hasNewer ?? false),
  cap,
});

const start = (id: number, kind: RequestKind): Action => ({
  type: "started",
  id,
  kind,
});

const run = (
  actions: Action[],
  from: State = initialTimeline as Timeline<undefined>,
) => actions.reduce(timelineReducer<undefined>, from);

// A window from an open: by default the newest page.
const opened = (ids: string[], edges: Parameters<typeof loaded>[2] = {}) =>
  run([start(1, "open"), loaded(1, ids, edges)]);

const live = (payload: Parameters<typeof event>[0]): Action => ({
  type: "event",
  event: event(payload),
});
const posted = (
  id: string,
  init: MessageInitShape<typeof MessageSchema> = {},
) => live({ case: "messageCreated", value: message(id, init) });
const edited = (id: string, content: string) =>
  live({ case: "messageUpdated", value: message(id, { content }) });
const deleted = (id: string) =>
  live({ case: "messageDeleted", value: { channelId: "c1", messageId: id } });

const ready = (state: State) => {
  if (state.shown.state !== "ready") throw new Error(state.shown.state);
  return state.shown;
};
const ids = (state: State) => ready(state).page.messages.map((held) => held.id);
const text = (state: State, id: string) =>
  ready(state).page.messages.find((held) => held.id === id)?.content;

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
        start(2, "open"),
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
