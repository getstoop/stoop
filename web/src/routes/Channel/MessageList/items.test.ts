import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import {
  type Message,
  MessageSchema,
  SystemEventSchema,
} from "../../../gen/stoop/chat/v1/message_pb";
import {
  estimateSize,
  indexOfMessage,
  indexOfNewLine,
  isOwnPost,
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
      case "system":
        return `${item.key} (system)`;
      case "poll":
        return `${item.key} (poll)`;
      case "reminder":
        return `${item.key} (reminder)`;
      default:
        return `[${item.label}]`;
    }
  });

const system = (id: string, at: Date): Message => {
  const made = message(id, at);
  made.quiet = true;
  made.event = create(SystemEventSchema, {
    kind: { case: "memberLeft", value: {} },
  });
  return made;
};

describe("system rows", () => {
  const at = (minute: number, second: number) =>
    new Date(2026, 9, 21, 9, minute, second);
  const items = listItems({
    messages: [
      message("01", at(0, 0)),
      system("02", at(0, 10)),
      message("03", at(0, 20)),
    ],
    firstNewId: undefined,
    inThread: false,
    now,
  });

  it("are items of their own, and break a run of messages", () => {
    expect(rows(items)).toEqual([
      "<head>",
      "[Today]",
      "01",
      "02 (system)",
      "03",
      "<foot>",
    ]);
  });

  it("are found by a jump, and have a height before measuring", () => {
    expect(indexOfMessage(items, "02")).toBe(3);
    expect(estimateSize(items[3])).toBeGreaterThan(0);
  });
});

describe("reminders", () => {
  const at = (second: number) => new Date(2026, 9, 21, 9, 0, second);
  // The same author all within a minute: a message would continue the
  // one before it, a reminder never does, nor is continued.
  const reminder = (id: string): Message => {
    const made = message(id, at(10));
    made.event = create(SystemEventSchema, {
      kind: { case: "reminder", value: {} },
    });
    return made;
  };
  const items = listItems({
    messages: [message("01", at(0)), reminder("02"), message("03", at(20))],
    firstNewId: undefined,
    inThread: false,
    now,
  });

  it("are items of their own that break a run", () => {
    expect(rows(items)).toEqual([
      "<head>",
      "[Today]",
      "01",
      "02 (reminder)",
      "03",
      "<foot>",
    ]);
  });

  it("are found by a jump, with room for a line of text", () => {
    expect(indexOfMessage(items, "02")).toBe(3);
    expect(estimateSize(items[3])).toBeGreaterThan(40);
  });
});

describe("polls", () => {
  const at = (second: number) => new Date(2026, 9, 21, 9, 0, second);
  const poll = (id: string, options: number): Message => {
    const made = message(id, at(10));
    made.event = create(SystemEventSchema, {
      kind: {
        case: "poll",
        value: {
          question: "Friday?",
          options: Array.from({ length: options }, (_, index) => ({
            id: index + 1,
            text: `Option ${index + 1}`,
          })),
        },
      },
    });
    return made;
  };
  // All by the same author within the minute.
  const items = listItems({
    messages: [message("01", at(0)), poll("02", 3), message("03", at(20))],
    firstNewId: undefined,
    inThread: false,
    now,
  });

  it("are items of their own, never continuing or continued", () => {
    expect(rows(items)).toEqual([
      "<head>",
      "[Today]",
      "01",
      "02 (poll)",
      "03",
      "<foot>",
    ]);
  });

  it("are found by a jump, and grow with their options before measuring", () => {
    expect(indexOfMessage(items, "02")).toBe(3);
    const ten = listItems({
      messages: [poll("04", 10)],
      firstNewId: undefined,
      inThread: false,
      now,
    });
    expect(estimateSize(ten[2])).toBeGreaterThan(estimateSize(items[3]));
    expect(estimateSize(items[3])).toBeGreaterThan(estimateSize(items[2]));
  });
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

describe("isOwnPost", () => {
  const at = new Date(2026, 9, 21, 9, 0);
  const of = (
    kind: "poll" | "pollClosed" | "memberLeft" | "reminder" | undefined,
    authorId = "dee",
  ) => {
    const made = message("01", at, authorId);
    if (kind === "poll")
      made.event = create(SystemEventSchema, {
        kind: { case: "poll", value: { question: "Friday?" } },
      });
    if (kind === "pollClosed")
      made.event = create(SystemEventSchema, {
        kind: { case: "pollClosed", value: { question: "Friday?" } },
      });
    if (kind === "reminder")
      made.event = create(SystemEventSchema, {
        kind: { case: "reminder", value: {} },
      });
    if (kind === "memberLeft")
      made.event = create(SystemEventSchema, {
        kind: { case: "memberLeft", value: {} },
      });
    return made;
  };

  it("is my message, my poll and my poll's closing row", () => {
    expect(isOwnPost(of(undefined), "dee")).toBe(true);
    expect(isOwnPost(of("poll"), "dee")).toBe(true);
    expect(isOwnPost(of("pollClosed"), "dee")).toBe(true);
  });

  it("is not another system row of mine, nor anyone else's row", () => {
    expect(isOwnPost(of("memberLeft"), "dee")).toBe(false);
    // A reminder of mine the server delivered: the list does not follow it.
    expect(isOwnPost(of("reminder"), "dee")).toBe(false);
    expect(isOwnPost(of("pollClosed", "eve"), "dee")).toBe(false);
    expect(isOwnPost(of("poll", "eve"), "dee")).toBe(false);
    expect(isOwnPost(of(undefined), undefined)).toBe(false);
    expect(isOwnPost(undefined, "dee")).toBe(false);
  });
});
