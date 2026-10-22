import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import {
  type Message,
  MessageAuthorSchema,
  MessageSchema,
  ThreadSummarySchema,
} from "../gen/stoop/chat/v1/message_pb";
import {
  continues,
  firstNewMessageId,
  groupedRows,
  sameMinute,
  startsDay,
} from "./grouping";

const at = (time: string) => timestampFromDate(new Date(`2026-10-15T${time}`));

const message = (
  id: string,
  time: string,
  extra: MessageInitShape<typeof MessageSchema> = {},
): Message => {
  const made = create(MessageSchema, extra);
  made.id = id;
  made.createdAt = at(time);
  made.author ??= create(MessageAuthorSchema, { id: "casey" });
  return made;
};

describe("continues", () => {
  const first = message("m1", "10:00:05");

  it("groups the same author within a minute", () => {
    expect(continues(message("m2", "10:00:40"), first, undefined, false)).toBe(
      true,
    );
    expect(continues(message("m2", "10:01:00"), first, undefined, false)).toBe(
      false,
    );
    expect(
      continues(
        message("m2", "10:00:40", { author: { id: "ada" } }),
        first,
        undefined,
        false,
      ),
    ).toBe(false);
    expect(continues(first, undefined, undefined, false)).toBe(false);
  });

  it("starts afresh at a reply or the new-messages line", () => {
    const reply = message("m2", "10:00:40", { replyTo: { messageId: "m1" } });
    expect(continues(reply, first, undefined, false)).toBe(false);
    expect(continues(message("m2", "10:00:40"), first, "m2", false)).toBe(
      false,
    );
  });

  it("starts afresh after a deleted root's placeholder, and at one", () => {
    const placeholder = message("m1", "10:00:05", { deleted: true });
    expect(
      continues(message("m2", "10:00:40"), placeholder, undefined, false),
    ).toBe(false);
    expect(
      continues(
        message("m2", "10:00:40", { deleted: true }),
        first,
        undefined,
        false,
      ),
    ).toBe(false);
  });

  it("starts afresh after a thread's summary line", () => {
    const root = message("m1", "10:00:05", {
      thread: create(ThreadSummarySchema, { replyCount: 1 }),
    });
    expect(continues(message("m2", "10:00:40"), root, undefined, false)).toBe(
      false,
    );
  });

  it("starts afresh at a thread reply in the channel, not in the thread", () => {
    const alsoSent = message("m2", "10:00:40", {
      threadRootId: "r1",
      threadRoot: { messageId: "r1" },
    });
    expect(continues(alsoSent, first, undefined, false)).toBe(false);
    expect(continues(alsoSent, first, undefined, true)).toBe(true);
  });
});

describe("startsDay", () => {
  it("marks the first message and the first of each day", () => {
    expect(startsDay(message("m1", "10:00:00"), undefined)).toBe(true);
    expect(
      startsDay(message("m2", "23:59:00"), message("m1", "10:00:00")),
    ).toBe(false);
    const nextDay = create(MessageSchema, {
      id: "m3",
      createdAt: timestampFromDate(new Date("2026-10-16T00:01:00")),
    });
    expect(startsDay(nextDay, message("m2", "23:59:00"))).toBe(true);
  });
});

describe("sameMinute", () => {
  it("compares to the minute", () => {
    const a = new Date("2026-10-15T10:00:59");
    expect(sameMinute(a, new Date("2026-10-15T10:00:00"))).toBe(true);
    expect(sameMinute(a, new Date("2026-10-15T10:01:00"))).toBe(false);
  });
});

describe("firstNewMessageId", () => {
  const from = (id: string, author: string) =>
    message(id, "10:00:00", { author: { id: author } });
  const list = [from("01", "ada"), from("02", "me"), from("03", "bea")];

  it("is the first message after the marker", () => {
    expect(firstNewMessageId(list, "01", "me")).toBe("03");
    expect(firstNewMessageId(list, "", "me")).toBe("01");
  });

  it("skips the reader's own messages", () => {
    expect(firstNewMessageId([from("02", "me")], "01", "me")).toBeUndefined();
  });

  it("is none when nothing is new, or no marker was taken", () => {
    expect(firstNewMessageId(list, "03", "me")).toBeUndefined();
    expect(firstNewMessageId(list, null, "me")).toBeUndefined();
  });
});

describe("groupedRows", () => {
  const now = new Date(2026, 9, 21, 12, 0);
  const dated = (id: string, when: Date, authorId = "dee"): Message =>
    create(MessageSchema, {
      id,
      channelId: "c1",
      author: { id: authorId },
      createdAt: timestampFromDate(when),
    });
  const drawn = (rows: ReturnType<typeof groupedRows>) =>
    rows.map((row) =>
      row.kind === "message"
        ? `${row.key}${row.continued ? " +" : ""}`
        : `[${row.label}]`,
    );

  it("puts a day line above each day and runs a minute's messages on", () => {
    const messages = [
      dated("01", new Date(2026, 9, 20, 9, 0)),
      dated("02", new Date(2026, 9, 21, 9, 0)),
      dated("03", new Date(2026, 9, 21, 9, 0, 30)),
    ];
    expect(drawn(groupedRows(messages, null, "me", now))).toEqual([
      "[Yesterday]",
      "01",
      "[Today]",
      "02",
      "03 +",
    ]);
  });

  it("draws the New line above the first new message, sharing a day's", () => {
    const messages = [
      dated("01", new Date(2026, 9, 21, 9, 0)),
      dated("02", new Date(2026, 9, 21, 9, 0, 10)),
      dated("03", new Date(2026, 9, 21, 9, 0, 20)),
    ];
    expect(drawn(groupedRows(messages, "01", "me", now))).toEqual([
      "[Today]",
      "01",
      "[New]",
      "02",
      "03 +",
    ]);
    expect(drawn(groupedRows(messages, "", "me", now))).toEqual([
      "[Today · New]",
      "01",
      "02 +",
      "03 +",
    ]);
  });

  it("skips the reader's own messages for the New line", () => {
    const messages = [
      dated("01", new Date(2026, 9, 21, 9, 0), "me"),
      dated("02", new Date(2026, 9, 21, 9, 5)),
    ];
    expect(drawn(groupedRows(messages, "", "me", now))).toEqual([
      "[Today]",
      "01",
      "[New]",
      "02",
    ]);
  });
});
