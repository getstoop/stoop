import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import { type Message, MessageSchema } from "../gen/stoop/chat/v1/message_pb";
import { timelineItems } from "./timelineItems";

const now = new Date(2026, 9, 21, 12, 0);

const message = (id: string, at: Date, authorId = "dee"): Message =>
  create(MessageSchema, {
    id,
    channelId: "c1",
    author: { id: authorId },
    createdAt: timestampFromDate(at),
  });

const rows = (items: ReturnType<typeof timelineItems>) =>
  items.map((item) =>
    item.kind === "message"
      ? `${item.key}${item.continued ? " +" : ""}`
      : `[${item.label}]`,
  );

describe("timelineItems", () => {
  it("puts a day line above each day and runs a minute's messages on", () => {
    const messages = [
      message("01", new Date(2026, 9, 20, 9, 0)),
      message("02", new Date(2026, 9, 21, 9, 0)),
      message("03", new Date(2026, 9, 21, 9, 0, 30)),
    ];
    expect(rows(timelineItems(messages, null, "me", now))).toEqual([
      "[Yesterday]",
      "01",
      "[Today]",
      "02",
      "03 +",
    ]);
  });

  it("draws the New line above the first new message, sharing a day's", () => {
    const messages = [
      message("01", new Date(2026, 9, 21, 9, 0)),
      message("02", new Date(2026, 9, 21, 9, 0, 10)),
      message("03", new Date(2026, 9, 21, 9, 0, 20)),
    ];
    expect(rows(timelineItems(messages, "01", "me", now))).toEqual([
      "[Today]",
      "01",
      "[New]",
      "02",
      "03 +",
    ]);
    expect(rows(timelineItems(messages, "", "me", now))).toEqual([
      "[Today · New]",
      "01",
      "02 +",
      "03 +",
    ]);
  });

  it("skips the reader's own messages for the New line", () => {
    const messages = [
      message("01", new Date(2026, 9, 21, 9, 0), "me"),
      message("02", new Date(2026, 9, 21, 9, 5)),
    ];
    expect(rows(timelineItems(messages, "", "me", now))).toEqual([
      "[Today]",
      "01",
      "[New]",
      "02",
    ]);
  });
});
