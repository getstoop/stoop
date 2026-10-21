import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { type Channel, ChannelSchema } from "../gen/stoop/chat/v1/channel_pb";
import { type Message, MessageSchema } from "../gen/stoop/chat/v1/message_pb";
import { SpaceSchema } from "../gen/stoop/chat/v1/space_pb";
import {
  type ServerEvent,
  ServerEventSchema,
} from "../gen/stoop/realtime/v1/realtime_pb";
import type { ChannelHeader } from "./timelineEvents";
import {
  heldBack,
  initialTimeline,
  olderBefore,
  reconnectLoad,
  type Timeline,
  type TimelineAction,
  timelineReducer,
} from "./timelineState";

type Action = TimelineAction<ChannelHeader>;
// Every action but an answer, which carries no header.
type Plain = Exclude<TimelineAction, { type: "loaded" }>;
type State = Timeline<ChannelHeader>;

const message = (
  id: string,
  init: MessageInitShape<typeof MessageSchema> = {},
): Message =>
  create(MessageSchema, { id, channelId: "c1", content: id, ...init });

const event = (
  payload: MessageInitShape<typeof ServerEventSchema>["payload"],
): ServerEvent => create(ServerEventSchema, { payload });

const header = (init: Partial<ChannelHeader> = {}): ChannelHeader => ({
  space: create(SpaceSchema, { id: "s1", name: "The Porch" }),
  channel: create(ChannelSchema, { id: "c1", name: "general" }),
  memberCount: 3,
  myUserId: "me",
  ...init,
});

// An open or catch-up's answer: the messages by id (or as given), and the
// header.
const loaded = (
  id: number,
  messages: (string | Message)[],
  init: Partial<ChannelHeader> & { hasOlder?: boolean } = {},
): Action => {
  const { hasOlder = true, ...facts } = init;
  const answer = header(facts);
  return {
    type: "loaded",
    id,
    channelId: "c1",
    page: {
      messages: messages.map((one) =>
        typeof one === "string" ? message(one) : one,
      ),
      hasOlder,
    },
    header: answer,
    newAfter: answer.channel.lastReadMessageId,
  };
};

const paged = (id: number, ids: string[], hasOlder = false): Plain => ({
  type: "paged",
  id,
  page: { messages: ids.map((one) => message(one)), hasOlder },
});

const start = (id: number, kind: "open" | "catchUp" | "older"): Plain => ({
  type: "started",
  id,
  kind,
});

const run = (actions: Action[], from: State = initialTimeline) =>
  actions.reduce(timelineReducer<ChannelHeader>, from);

const opened = (messages: string[], init: Parameters<typeof loaded>[2] = {}) =>
  run([start(1, "open"), loaded(1, messages, init)]);

const live = (payload: Parameters<typeof event>[0]): Plain => ({
  type: "event",
  event: event(payload),
});

const posted = (id: string) =>
  live({ case: "messageCreated", value: message(id) });
const edited = (id: string, content: string) =>
  live({ case: "messageUpdated", value: message(id, { content }) });
const deleted = (id: string) =>
  live({ case: "messageDeleted", value: { channelId: "c1", messageId: id } });
const channelGone = live({
  case: "channelDeleted",
  value: { channelId: "c1" },
});

const ready = (state: State) => {
  if (state.shown.state !== "ready") throw new Error(state.shown.state);
  return state.shown;
};
const ids = (state: State) => ready(state).page.messages.map((held) => held.id);
const text = (state: State, id: string) =>
  ready(state).page.messages.find((held) => held.id === id)?.content;
const channel = (init: MessageInitShape<typeof ChannelSchema>): Channel =>
  create(ChannelSchema, { id: "c1", ...init });

describe("opening", () => {
  it("replays what arrived during the first load over its answer", () => {
    const state = run([
      start(1, "open"),
      posted("04"),
      edited("02", "reworded"),
      loaded(1, ["01", "02", "03"]),
    ]);
    expect(ids(state)).toEqual(["01", "02", "03", "04"]);
    expect(text(state, "02")).toBe("reworded");
    expect(state.requests).toEqual([]);
  });

  it("starts again on a reconnect, and only the latest load counts", () => {
    const loading = run([start(1, "open")]);
    expect(reconnectLoad(loading)).toBe("open");
    const restarted = run([start(2, "open"), loaded(1, ["01"])], loading);
    expect(restarted.shown.state).toBe("loading");
    const state = run([loaded(2, ["01", "02"])], restarted);
    expect(ids(state)).toEqual(["01", "02"]);
  });

  it("keeps the read marker it opened with for the New line", () => {
    const state = opened(["01", "02"], {
      channel: channel({ lastReadMessageId: "01" }),
    });
    expect(ready(state).newAfter).toBe("01");
  });

  it("shows a failed open, and loading again on a retry", () => {
    const failed = run([
      start(1, "open"),
      { type: "failed", id: 1, outcome: "failed" },
    ]);
    expect(failed.shown.state).toBe("failed");
    expect(reconnectLoad(failed)).toBe("open");
    expect(run([{ type: "retried" }], failed).shown.state).toBe("loading");
  });

  it("drops an older page asked for before an open", () => {
    const state = run(
      [start(2, "older"), start(3, "open"), paged(2, ["01", "02"])],
      opened(["05", "06"]),
    );
    expect(state.requests.map((out) => out.id)).toEqual([3]);
    const reopened = run(
      [loaded(3, ["07", "08"]), paged(2, ["01", "02"])],
      state,
    );
    expect(ids(reopened)).toEqual(["07", "08"]);
    expect(ready(reopened).loadingOlder).toBe(false);
  });

  it("drops an older page asked for above the window an open replaced", () => {
    const state = run(
      [
        start(2, "open"),
        start(3, "older"),
        loaded(2, ["07", "08"]),
        paged(3, ["01", "02"]),
      ],
      opened(["05", "06"]),
    );
    expect(ids(state)).toEqual(["07", "08"]);
    expect(olderBefore(state)).toBe("07");
  });
});

describe("losing the channel", () => {
  it("is gone, whatever a load still out says", () => {
    const state = run(
      [start(2, "catchUp"), channelGone, loaded(2, ["01"])],
      opened(["01"]),
    );
    expect(state.shown.state).toBe("gone");
    expect(reconnectLoad(state)).toBeNull();
  });

  it("is gone, whatever an older page still out says", () => {
    const state = run(
      [start(2, "older"), channelGone, paged(2, ["01"])],
      opened(["05"]),
    );
    expect(state.shown.state).toBe("gone");
    expect(state.requests).toEqual([]);
  });

  it("stays gone when a load lands late", () => {
    const gone = run([channelGone], opened(["01"]));
    expect(run([loaded(1, ["01"])], gone).shown.state).toBe("gone");
  });

  it("is lost by the reader's removal from the space", () => {
    const state = run(
      [live({ case: "memberRemoved", value: { spaceId: "s1", userId: "me" } })],
      opened(["01"]),
    );
    expect(state.shown.state).toBe("gone");
  });
});

describe("catching up", () => {
  it("brings back a post, an edit and a deletion made during it", () => {
    const shown = opened(["01", "02", "03"]);
    expect(reconnectLoad(shown)).toBe("catchUp");
    expect(heldBack(shown)).toBe("01");
    const state = run(
      [
        start(2, "catchUp"),
        posted("05"),
        edited("02", "reworded"),
        deleted("01"),
        // Read from the server before those arrived.
        loaded(2, ["01", "02", "03", "04"]),
      ],
      shown,
    );
    expect(ids(state)).toEqual(["02", "03", "04", "05"]);
    expect(text(state, "02")).toBe("reworded");
  });

  it("keeps what is shown when it fails", () => {
    const state = run(
      [
        start(2, "catchUp"),
        posted("04"),
        { type: "failed", id: 2, outcome: "failed" },
      ],
      opened(["01", "02", "03"]),
    );
    expect(ids(state)).toEqual(["01", "02", "03", "04"]);
    expect(state.requests).toEqual([]);
  });

  it("ends the screen when the sign-in has ended", () => {
    const state = run(
      [start(2, "catchUp"), { type: "failed", id: 2, outcome: "ended" }],
      opened(["01"]),
    );
    expect(state.shown.state).toBe("ended");
  });

  it("is gone when the reload finds the channel gone", () => {
    const state = run(
      [start(2, "catchUp"), { type: "failed", id: 2, outcome: "gone" }],
      opened(["01"]),
    );
    expect(state.shown.state).toBe("gone");
  });

  it("counts only the latest of two", () => {
    const state = run(
      [
        start(2, "catchUp"),
        start(3, "catchUp"),
        loaded(2, ["01", "02"]),
        { type: "failed", id: 2, outcome: "gone" },
      ],
      opened(["01"]),
    );
    expect(ids(state)).toEqual(["01"]);
    const latest = run([loaded(3, ["01", "02", "03"])], state);
    expect(ids(latest)).toEqual(["01", "02", "03"]);
    expect(latest.requests).toEqual([]);
  });

  it("keeps the history above a newest page that reaches into it", () => {
    const state = run(
      [start(2, "catchUp"), loaded(2, ["02", "03", "04"], { memberCount: 5 })],
      opened(["01", "02", "03"], { hasOlder: false }),
    );
    expect(ids(state)).toEqual(["01", "02", "03", "04"]);
    expect(ready(state).page.hasOlder).toBe(false);
    expect(ready(state).header.memberCount).toBe(5);
  });
});

describe("older pages", () => {
  it("replays an edit made during the load over the page alone", () => {
    const shown = opened(["05", "06"]);
    expect(olderBefore(shown)).toBe("05");
    const paging = run([start(2, "older")], shown);
    expect(ready(paging).loadingOlder).toBe(true);
    expect(olderBefore(paging)).toBeNull();
    const state = run(
      [edited("02", "reworded"), posted("07"), paged(2, ["01", "02"])],
      paging,
    );
    expect(ids(state)).toEqual(["01", "02", "05", "06", "07"]);
    expect(text(state, "02")).toBe("reworded");
    expect(ready(state).loadingOlder).toBe(false);
    expect(ready(state).page.hasOlder).toBe(false);
    expect(olderBefore(state)).toBeNull();
  });

  it("ignores a second while one is out", () => {
    const paging = run([start(2, "older"), start(3, "older")], opened(["05"]));
    expect(paging.requests.map((out) => out.id)).toEqual([2]);
    const ignored = run(
      [paged(3, ["03", "04"]), { type: "failed", id: 3, outcome: "failed" }],
      paging,
    );
    expect(ready(ignored).loadingOlder).toBe(true);
    expect(ids(ignored)).toEqual(["05"]);
    const state = run([paged(2, ["01", "02"])], ignored);
    expect(ids(state)).toEqual(["01", "02", "05"]);
    expect(ready(state).loadingOlder).toBe(false);
  });

  it("drops a page that lands after a reconnect", () => {
    const state = run(
      [
        start(2, "older"),
        start(3, "catchUp"),
        loaded(3, ["05", "06", "07"]),
        paged(2, ["01", "02"]),
      ],
      opened(["05", "06"]),
    );
    expect(ids(state)).toEqual(["05", "06", "07"]);
    expect(ready(state).loadingOlder).toBe(false);
    expect(ready(state).page.hasOlder).toBe(true);
  });

  it("never lets an edit it kept undo what a catch-up refreshed", () => {
    const state = run(
      [
        start(2, "older"),
        edited("04", "first edit"),
        // Edited again while the socket was down, so only the reload has it.
        start(3, "catchUp"),
        loaded(3, ["03", message("04", { content: "second edit" })]),
        paged(2, ["01", "02"]),
      ],
      opened(["03", "04"]),
    );
    expect(text(state, "04")).toBe("second edit");
  });

  it("clears the spinner when the page fails", () => {
    const state = run(
      [start(2, "older"), { type: "failed", id: 2, outcome: "failed" }],
      opened(["05"]),
    );
    expect(ready(state).loadingOlder).toBe(false);
    expect(ids(state)).toEqual(["05"]);
  });
});

describe("the header", () => {
  it("follows a rename of the channel and of its space", () => {
    const state = run(
      [
        live({ case: "channelUpdated", value: channel({ name: "lobby" }) }),
        live({
          case: "spaceUpdated",
          value: { space: create(SpaceSchema, { id: "s1", name: "The Yard" }) },
        }),
      ],
      opened(["01"]),
    );
    expect(ready(state).header.channel.name).toBe("lobby");
    expect(ready(state).header.space.name).toBe("The Yard");
  });

  it("counts a member once, live, never again on a replay", () => {
    const joined = live({
      case: "memberJoined",
      value: { spaceId: "s1", userId: "dee" },
    });
    // Joined during the first load, which already counts them.
    const first = run([
      start(1, "open"),
      joined,
      loaded(1, ["01"], { memberCount: 4 }),
    ]);
    expect(ready(first).header.memberCount).toBe(4);
    const counted = run([joined], first);
    expect(ready(counted).header.memberCount).toBe(5);
    // Joined during a catch-up: counted live, then the answer counts them.
    const caught = run(
      [start(2, "catchUp"), joined, loaded(2, ["01"], { memberCount: 6 })],
      counted,
    );
    expect(ready(caught).header.memberCount).toBe(6);
  });

  it("counts a private channel's own members, not the space's", () => {
    const state = run(
      [
        live({ case: "memberJoined", value: { spaceId: "s1", userId: "dee" } }),
        live({
          case: "channelMemberJoined",
          value: { channelId: "c1", userId: "dee" },
        }),
      ],
      opened(["01"], { channel: channel({ private: true }) }),
    );
    expect(ready(state).header.memberCount).toBe(4);
  });

  it("is optional: a window alone follows its messages", () => {
    const actions: TimelineAction<undefined>[] = [
      start(1, "open"),
      posted("02"),
      {
        type: "loaded",
        id: 1,
        channelId: "c1",
        page: { messages: [message("01")], hasOlder: false },
        header: undefined,
        newAfter: null,
      },
      edited("01", "reworded"),
    ];
    const state = actions.reduce(
      timelineReducer<undefined>,
      initialTimeline as Timeline<undefined>,
    );
    if (state.shown.state !== "ready") throw new Error(state.shown.state);
    expect(state.shown.page.messages.map((held) => held.content)).toEqual([
      "reworded",
      "02",
    ]);
    const gone = timelineReducer(state, channelGone);
    expect(gone.shown.state).toBe("gone");
  });
});
