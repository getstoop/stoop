import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import {
  type Message,
  MessageSchema,
} from "../../../gen/stoop/chat/v1/message_pb";
import {
  estimateSize,
  indexOfMessage,
  indexOfNewLine,
  type ListItem,
  listItems,
} from "./items";

const now = new Date(2026, 9, 21, 12, 0);

const message = (id: string, at: Date, authorId = "dee"): Message =>
  create(MessageSchema, {
    id,
    channelId: "c1",
    author: { id: authorId },
    createdAt: timestampFromDate(at),
  });

const rows = (items: ListItem[]) =>
  items.map((item) => {
    switch (item.kind) {
      case "message":
        return `${item.key}${item.continued ? " +" : ""}`;
      case "head":
        return item.rootId ? `<head root=${item.rootId}>` : "<head>";
      case "foot":
        return "<foot>";
      default:
        return `[${item.label}]`;
    }
  });

describe("listItems", () => {
  const messages = [
    message("01", new Date(2026, 9, 20, 9, 0)),
    message("02", new Date(2026, 9, 21, 9, 0)),
    message("03", new Date(2026, 9, 21, 9, 0, 30)),
  ];

  it("bookends the rows with the head and the foot", () => {
    expect(
      rows(listItems({ messages: [], firstNewId: undefined, inThread: false })),
    ).toEqual(["<head>", "<foot>"]);
  });

  it("puts a day line above each day and runs a minute's messages on", () => {
    expect(
      rows(
        listItems({ messages, firstNewId: undefined, inThread: false, now }),
      ),
    ).toEqual([
      "<head>",
      "[Yesterday]",
      "01",
      "[Today]",
      "02",
      "03 +",
      "<foot>",
    ]);
  });

  it("draws the New line above the first new message, sharing a day's", () => {
    const items = listItems({
      messages,
      firstNewId: "02",
      inThread: false,
      now,
    });
    expect(rows(items)).toEqual([
      "<head>",
      "[Yesterday]",
      "01",
      "[Today · New messages]",
      "02",
      "03 +",
      "<foot>",
    ]);
    const line = items[3];
    expect(line.kind === "new" && line.startsDay).toBe(true);
    expect(indexOfNewLine(items)).toBe(3);
  });

  it("a New line inside a day stands alone and breaks the run", () => {
    const items = listItems({
      messages,
      firstNewId: "03",
      inThread: false,
      now,
    });
    expect(rows(items)).toEqual([
      "<head>",
      "[Yesterday]",
      "01",
      "[Today]",
      "02",
      "[New messages]",
      "03",
      "<foot>",
    ]);
    const line = items[5];
    expect(line.kind === "new" && line.startsDay).toBe(false);
  });

  it("a thread has no day lines and its root on the head when shown", () => {
    const items = listItems({
      messages,
      firstNewId: undefined,
      inThread: true,
      rootShownId: "root",
      now,
    });
    expect(rows(items)).toEqual([
      "<head root=root>",
      "01",
      "02",
      "03 +",
      "<foot>",
    ]);
    expect(indexOfNewLine(items)).toBe(-1);
  });
});

describe("indexOfMessage", () => {
  const messages = [
    message("01", new Date(2026, 9, 21, 9, 0)),
    message("02", new Date(2026, 9, 21, 10, 0)),
  ];

  it("finds a message's row", () => {
    const items = listItems({
      messages,
      firstNewId: undefined,
      inThread: false,
      now,
    });
    expect(indexOfMessage(items, "02")).toBe(3);
    expect(indexOfMessage(items, "nope")).toBe(-1);
  });

  it("lands a jump to the shown root on the head, and nowhere when hidden", () => {
    const shown = listItems({
      messages,
      firstNewId: undefined,
      inThread: true,
      rootShownId: "root",
    });
    expect(indexOfMessage(shown, "root")).toBe(0);
    const hidden = listItems({
      messages,
      firstNewId: undefined,
      inThread: true,
    });
    expect(indexOfMessage(hidden, "root")).toBe(-1);
  });
});

describe("estimateSize", () => {
  it("guesses a continued row shorter than a first one", () => {
    const first = message("01", now);
    const items = listItems({
      messages: [first, message("02", now)],
      firstNewId: undefined,
      inThread: false,
      now,
    });
    const [head, day, one, two, foot] = items;
    expect(estimateSize(two)).toBeLessThan(estimateSize(one));
    for (const item of [head, day, foot]) {
      expect(estimateSize(item)).toBeGreaterThan(0);
    }
  });
});
