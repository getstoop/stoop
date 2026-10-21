import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { type Message, MessageSchema } from "../gen/stoop/chat/v1/message_pb";
import {
  type ServerEvent,
  ServerEventSchema,
} from "../gen/stoop/realtime/v1/realtime_pb";
import {
  losesChannel,
  mentionsMe,
  type Page,
  withChannelEvent,
  withNewestPage,
} from "./channelTimeline";

const message = (
  id: string,
  init: MessageInitShape<typeof MessageSchema> = {},
): Message =>
  create(MessageSchema, { id, channelId: "c1", content: id, ...init });

const event = (
  payload: MessageInitShape<typeof ServerEventSchema>["payload"],
): ServerEvent => create(ServerEventSchema, { payload });

const page = (ids: string[], hasOlder = true): Page => ({
  messages: ids.map((id) => message(id)),
  hasOlder,
});

const ids = (list: Message[]) => list.map((cached) => cached.id);

describe("withNewestPage", () => {
  it("keeps the history above a page that reaches back into it", () => {
    const merged = withNewestPage(
      page(["01", "02", "03", "04"], false),
      page(["03", "04", "05"]),
    );
    expect(ids(merged.messages)).toEqual(["01", "02", "03", "04", "05"]);
    expect(merged.hasOlder).toBe(false);
  });

  it("is the page alone when there is a gap", () => {
    const merged = withNewestPage(
      page(["01", "02"], false),
      page(["07", "08"]),
    );
    expect(ids(merged.messages)).toEqual(["07", "08"]);
    expect(merged.hasOlder).toBe(true);
  });

  it("is the page alone when it covers everything held", () => {
    const merged = withNewestPage(
      page(["03", "04"]),
      page(["01", "02", "03", "04"], false),
    );
    expect(ids(merged.messages)).toEqual(["01", "02", "03", "04"]);
    expect(merged.hasOlder).toBe(false);
  });

  it("drops what the page no longer has", () => {
    const merged = withNewestPage(
      page(["01", "02", "03", "04"]),
      page(["02", "04"]),
    );
    expect(ids(merged.messages)).toEqual(["01", "02", "04"]);
  });
});

describe("withChannelEvent", () => {
  it("adds a message in the channel once", () => {
    const created = event({ case: "messageCreated", value: message("03") });
    const once = withChannelEvent([message("01")], created, "c1");
    expect(ids(withChannelEvent(once, created, "c1"))).toEqual(["01", "03"]);
  });

  it("ignores another channel and a reply kept in its thread", () => {
    const list = [message("01")];
    const elsewhere = event({
      case: "messageCreated",
      value: message("02", { channelId: "c2" }),
    });
    const reply = event({
      case: "messageCreated",
      value: message("03", { threadRootId: "01" }),
    });
    expect(withChannelEvent(list, elsewhere, "c1")).toBe(list);
    expect(withChannelEvent(list, reply, "c1")).toBe(list);
  });

  it("brings back what a reconnect's older page missed", () => {
    // The page was fetched before these arrived; replaying them over the
    // merge restores the post, the edit and the deletion.
    const held = page(["01", "02", "03"]);
    const live = [
      event({ case: "messageCreated", value: message("04") }),
      event({
        case: "messageUpdated",
        value: message("02", { content: "reworded" }),
      }),
      event({
        case: "messageDeleted",
        value: { channelId: "c1", messageId: "01" },
      }),
    ];
    const merged = withNewestPage(held, page(["01", "02", "03"]));
    const replayed = live.reduce(
      (list, next) => withChannelEvent(list, next, "c1"),
      merged.messages,
    );
    expect(ids(replayed)).toEqual(["02", "03", "04"]);
    expect(replayed[0]?.content).toBe("reworded");
  });
});

describe("losesChannel", () => {
  it("is the channel or its space deleted, or the reader taken out", () => {
    const loses = (payload: Parameters<typeof event>[0]) =>
      losesChannel(event(payload), "s1", "c1", "me");
    expect(loses({ case: "channelDeleted", value: { channelId: "c1" } })).toBe(
      true,
    );
    expect(loses({ case: "channelDeleted", value: { channelId: "c2" } })).toBe(
      false,
    );
    expect(loses({ case: "spaceDeleted", value: { spaceId: "s1" } })).toBe(
      true,
    );
    expect(
      loses({ case: "memberRemoved", value: { spaceId: "s1", userId: "me" } }),
    ).toBe(true);
    expect(
      loses({ case: "memberRemoved", value: { spaceId: "s1", userId: "dee" } }),
    ).toBe(false);
    expect(
      loses({
        case: "channelMemberLeft",
        value: { channelId: "c1", userId: "me" },
      }),
    ).toBe(true);
  });
});

describe("mentionsMe", () => {
  it("is a mention of the reader by someone else, or @here", () => {
    expect(mentionsMe(message("01", { mentionUserIds: ["me"] }), "me")).toBe(
      true,
    );
    expect(mentionsMe(message("01", { mentionsHere: true }), "me")).toBe(true);
    expect(
      mentionsMe(
        message("01", { mentionUserIds: ["me"], author: { id: "me" } }),
        "me",
      ),
    ).toBe(false);
    expect(mentionsMe(message("01"), "me")).toBe(false);
  });
});
