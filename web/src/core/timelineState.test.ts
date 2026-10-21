import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { ChannelSchema } from "../gen/stoop/chat/v1/channel_pb";
import { type Message, MessageSchema } from "../gen/stoop/chat/v1/message_pb";
import { SpaceSchema } from "../gen/stoop/chat/v1/space_pb";
import {
  type ServerEvent,
  ServerEventSchema,
} from "../gen/stoop/realtime/v1/realtime_pb";
import {
  type ChannelView,
  heldBack,
  initialTimeline,
  olderBefore,
  reconnectLoad,
  type Timeline,
  type TimelineAction,
  timelineReducer,
} from "./timelineState";

const message = (
  id: string,
  init: MessageInitShape<typeof MessageSchema> = {},
): Message =>
  create(MessageSchema, { id, channelId: "c1", content: id, ...init });

const event = (
  payload: MessageInitShape<typeof ServerEventSchema>["payload"],
): ServerEvent => create(ServerEventSchema, { payload });

const view = (ids: string[], init: Partial<ChannelView> = {}): ChannelView => ({
  space: create(SpaceSchema, { id: "s1", name: "The Porch" }),
  channel: create(ChannelSchema, { id: "c1", name: "general" }),
  memberCount: 3,
  myUserId: "me",
  messages: ids.map((id) => message(id)),
  hasOlder: true,
  ...init,
});

const run = (actions: TimelineAction[], from = initialTimeline) =>
  actions.reduce(timelineReducer, from);

const opened = (held: ChannelView) =>
  run([
    { type: "started", id: 1, kind: "open" },
    { type: "loaded", id: 1, view: held },
  ]);

const live = (payload: Parameters<typeof event>[0]): TimelineAction => ({
  type: "event",
  event: event(payload),
});

const posted = (id: string) =>
  live({ case: "messageCreated", value: message(id) });
const edited = (id: string, content: string) =>
  live({ case: "messageUpdated", value: message(id, { content }) });
const deleted = (id: string) =>
  live({ case: "messageDeleted", value: { channelId: "c1", messageId: id } });

const ready = (state: Timeline) => {
  if (state.shown.state !== "ready") throw new Error(state.shown.state);
  return state.shown;
};
const ids = (state: Timeline) =>
  ready(state).view.messages.map((held) => held.id);
const text = (state: Timeline, id: string) =>
  ready(state).view.messages.find((held) => held.id === id)?.content;

describe("opening", () => {
  it("replays what arrived during the first load over its answer", () => {
    const state = run([
      { type: "started", id: 1, kind: "open" },
      posted("04"),
      edited("02", "reworded"),
      { type: "loaded", id: 1, view: view(["01", "02", "03"]) },
    ]);
    expect(ids(state)).toEqual(["01", "02", "03", "04"]);
    expect(text(state, "02")).toBe("reworded");
    expect(state.requests).toEqual([]);
  });

  it("starts again on a reconnect, and only the latest load counts", () => {
    const loading = run([{ type: "started", id: 1, kind: "open" }]);
    expect(reconnectLoad(loading)).toBe("open");
    const restarted = run(
      [
        { type: "started", id: 2, kind: "open" },
        { type: "loaded", id: 1, view: view(["01"]) },
      ],
      loading,
    );
    expect(restarted.shown.state).toBe("loading");
    const state = run(
      [{ type: "loaded", id: 2, view: view(["01", "02"]) }],
      restarted,
    );
    expect(ids(state)).toEqual(["01", "02"]);
  });

  it("keeps the read marker it opened with for the New line", () => {
    const state = opened(
      view(["01", "02"], {
        channel: create(ChannelSchema, { id: "c1", lastReadMessageId: "01" }),
      }),
    );
    expect(ready(state).newAfter).toBe("01");
  });

  it("shows a failed open, and loading again on a retry", () => {
    const failed = run([
      { type: "started", id: 1, kind: "open" },
      { type: "failed", id: 1, outcome: "failed" },
    ]);
    expect(failed.shown.state).toBe("failed");
    expect(reconnectLoad(failed)).toBe("open");
    expect(run([{ type: "retried" }], failed).shown.state).toBe("loading");
  });

  it("is gone when the channel goes, whatever a load still out says", () => {
    const state = run(
      [
        { type: "started", id: 2, kind: "catchUp" },
        live({ case: "channelDeleted", value: { channelId: "c1" } }),
        { type: "loaded", id: 2, view: view(["01"]) },
      ],
      opened(view(["01"])),
    );
    expect(state.shown.state).toBe("gone");
    expect(reconnectLoad(state)).toBeNull();
  });
});

describe("catching up", () => {
  it("brings back a post, an edit and a deletion made during it", () => {
    const shown = opened(view(["01", "02", "03"]));
    expect(reconnectLoad(shown)).toBe("catchUp");
    expect(heldBack(shown)).toBe("01");
    const state = run(
      [
        { type: "started", id: 2, kind: "catchUp" },
        posted("05"),
        edited("02", "reworded"),
        deleted("01"),
        // Read from the server before those arrived.
        { type: "loaded", id: 2, view: view(["01", "02", "03", "04"]) },
      ],
      shown,
    );
    expect(ids(state)).toEqual(["02", "03", "04", "05"]);
    expect(text(state, "02")).toBe("reworded");
  });

  it("keeps what is shown when it fails", () => {
    const state = run(
      [
        { type: "started", id: 2, kind: "catchUp" },
        posted("04"),
        { type: "failed", id: 2, outcome: "failed" },
      ],
      opened(view(["01", "02", "03"])),
    );
    expect(ids(state)).toEqual(["01", "02", "03", "04"]);
    expect(state.requests).toEqual([]);
  });

  it("is gone when the reload finds the channel gone", () => {
    const state = run(
      [
        { type: "started", id: 2, kind: "catchUp" },
        { type: "failed", id: 2, outcome: "gone" },
      ],
      opened(view(["01"])),
    );
    expect(state.shown.state).toBe("gone");
  });

  it("keeps the history above a newest page that reaches into it", () => {
    const state = run(
      [
        { type: "started", id: 2, kind: "catchUp" },
        {
          type: "loaded",
          id: 2,
          view: view(["02", "03", "04"], { memberCount: 5 }),
        },
      ],
      opened(view(["01", "02", "03"], { hasOlder: false })),
    );
    expect(ids(state)).toEqual(["01", "02", "03", "04"]);
    expect(ready(state).view.hasOlder).toBe(false);
    expect(ready(state).view.memberCount).toBe(5);
  });
});

describe("older pages", () => {
  it("replays an edit made during the load over the page alone", () => {
    const shown = opened(view(["05", "06"]));
    expect(olderBefore(shown)).toBe("05");
    const paging = run([{ type: "started", id: 2, kind: "older" }], shown);
    expect(ready(paging).loadingOlder).toBe(true);
    expect(olderBefore(paging)).toBeNull();
    const state = run(
      [
        edited("02", "reworded"),
        posted("07"),
        {
          type: "paged",
          id: 2,
          page: { messages: [message("01"), message("02")], hasOlder: false },
        },
      ],
      paging,
    );
    expect(ids(state)).toEqual(["01", "02", "05", "06", "07"]);
    expect(text(state, "02")).toBe("reworded");
    expect(ready(state).loadingOlder).toBe(false);
    expect(ready(state).view.hasOlder).toBe(false);
    expect(olderBefore(state)).toBeNull();
  });

  it("drops a page that lands after a reconnect", () => {
    const state = run(
      [
        { type: "started", id: 2, kind: "older" },
        { type: "started", id: 3, kind: "catchUp" },
        { type: "loaded", id: 3, view: view(["05", "06", "07"]) },
        {
          type: "paged",
          id: 2,
          page: { messages: [message("01"), message("02")], hasOlder: false },
        },
      ],
      opened(view(["05", "06"])),
    );
    expect(ids(state)).toEqual(["05", "06", "07"]);
    expect(ready(state).loadingOlder).toBe(false);
    expect(ready(state).view.hasOlder).toBe(true);
  });

  it("never lets an edit it kept undo what a catch-up refreshed", () => {
    const state = run(
      [
        { type: "started", id: 2, kind: "older" },
        edited("04", "first edit"),
        // Edited again while the socket was down, so only the reload has it.
        { type: "started", id: 3, kind: "catchUp" },
        {
          type: "loaded",
          id: 3,
          view: {
            ...view([]),
            messages: [
              message("03"),
              message("04", { content: "second edit" }),
            ],
          },
        },
        {
          type: "paged",
          id: 2,
          page: { messages: [message("01"), message("02")], hasOlder: false },
        },
      ],
      opened(view(["03", "04"])),
    );
    expect(text(state, "04")).toBe("second edit");
  });

  it("clears the spinner when the page fails", () => {
    const state = run(
      [
        { type: "started", id: 2, kind: "older" },
        { type: "failed", id: 2, outcome: "failed" },
      ],
      opened(view(["05"])),
    );
    expect(ready(state).loadingOlder).toBe(false);
    expect(ids(state)).toEqual(["05"]);
  });
});

describe("the title", () => {
  it("follows a rename of the channel and of its space", () => {
    const state = run(
      [
        live({
          case: "channelUpdated",
          value: create(ChannelSchema, { id: "c1", name: "lobby" }),
        }),
        live({
          case: "spaceUpdated",
          value: { space: create(SpaceSchema, { id: "s1", name: "The Yard" }) },
        }),
      ],
      opened(view(["01"])),
    );
    expect(ready(state).view.channel.name).toBe("lobby");
    expect(ready(state).view.space.name).toBe("The Yard");
  });

  it("counts a member once, live, never again on a replay", () => {
    const joined = live({
      case: "memberJoined",
      value: { spaceId: "s1", userId: "dee" },
    });
    // Joined during the first load, which already counts them.
    const first = run([
      { type: "started", id: 1, kind: "open" },
      joined,
      { type: "loaded", id: 1, view: view(["01"], { memberCount: 4 }) },
    ]);
    expect(ready(first).view.memberCount).toBe(4);
    const live1 = run([joined], first);
    expect(ready(live1).view.memberCount).toBe(5);
    // Joined during a catch-up: counted live, then the answer counts them.
    const caught = run(
      [
        { type: "started", id: 2, kind: "catchUp" },
        joined,
        { type: "loaded", id: 2, view: view(["01"], { memberCount: 6 }) },
      ],
      live1,
    );
    expect(ready(caught).view.memberCount).toBe(6);
  });

  it("counts a private channel's own members, not the space's", () => {
    const shown = opened(
      view(["01"], {
        channel: create(ChannelSchema, { id: "c1", private: true }),
      }),
    );
    const state = run(
      [
        live({ case: "memberJoined", value: { spaceId: "s1", userId: "dee" } }),
        live({
          case: "channelMemberJoined",
          value: { channelId: "c1", userId: "dee" },
        }),
      ],
      shown,
    );
    expect(ready(state).view.memberCount).toBe(4);
  });
});
