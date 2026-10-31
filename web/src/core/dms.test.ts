import { describe, expect, it } from "vitest";
import type { Channel } from "../gen/stoop/chat/v1/channel_pb";
import type { DirectMessage } from "../gen/stoop/chat/v1/chat_pb";
import type { MessageAuthor } from "../gen/stoop/chat/v1/message_pb";
import {
  dmFaces,
  dmIsGroup,
  dmOther,
  dmPreview,
  dmTime,
  dmTitle,
  dmUnreadTotal,
} from "./dms";

const author = (
  id: string,
  username: string,
  displayName = "",
): MessageAuthor => ({ id, username, displayName }) as MessageAuthor;

const channel = (id: string, lastMessageId = ""): Channel =>
  ({ id, lastMessageId, lastReadMessageId: "", unreadCount: 0 }) as Channel;

const unreadChannel = (id: string, unreadCount: number, muted = false) =>
  ({
    id,
    lastMessageId: "",
    lastReadMessageId: "",
    unreadCount,
    muted,
  }) as Channel;

const dm = (c: Channel, participants: MessageAuthor[] = []): DirectMessage =>
  ({ channel: c, participants }) as unknown as DirectMessage;

// More than two people is a group; membership never changes, so the count
// is the whole test.
const groupDm = dm;

const casey = author("u1", "casey", "Casey");
const ada = author("u2", "ada", "Ada W.");
const bea = author("u3", "bea");

describe("dmOther", () => {
  it("is the participant who isn't me", () => {
    expect(dmOther(dm(channel("d1"), [casey, ada]), "u1")).toBe(ada);
    expect(dmOther(dm(channel("d1"), [ada, casey]), "u1")).toBe(ada);
  });

  // A note to self has only me in it; showing my own name beats showing
  // nothing.
  it("falls back to me when I am the only participant", () => {
    expect(dmOther(dm(channel("d1"), [casey]), "u1")).toBe(casey);
  });

  it("takes the first participant when I am not known yet", () => {
    expect(dmOther(dm(channel("d1"), [casey, ada]), undefined)).toBe(casey);
  });

  it("is undefined when there are no participants", () => {
    expect(dmOther(dm(channel("d1")), "u1")).toBeUndefined();
  });
});

describe("dmTitle", () => {
  it("prefers the other person's display name", () => {
    expect(dmTitle(dm(channel("d1"), [casey, ada]), "u1")).toBe("Ada W.");
  });

  it("falls back to their username", () => {
    expect(dmTitle(dm(channel("d1"), [casey, bea]), "u1")).toBe("bea");
  });

  it("has a placeholder when there is nobody to name", () => {
    expect(dmTitle(dm(channel("d1")), "u1")).toBe("…");
  });
});

const dee = author("u4", "dee", "Dee");
const eli = author("u5", "eli", "Eli");

describe("dmTitle for a group", () => {
  const group = (...people: MessageAuthor[]) =>
    groupDm(channel("g1"), [casey, ...people]);

  it("names two people with an and", () => {
    expect(dmTitle(group(ada, bea), "u1")).toBe("Ada W. and bea");
  });

  it("names three", () => {
    expect(dmTitle(group(ada, bea, dee), "u1")).toBe("Ada W., bea and Dee");
  });

  it("counts the rest past three", () => {
    expect(dmTitle(group(ada, bea, dee, eli), "u1")).toBe(
      "Ada W., bea and 2 others",
    );
  });

  it("leaves a 1:1 alone", () => {
    expect(dmIsGroup(dm(channel("d1"), [casey, ada]))).toBe(false);
    expect(dmTitle(dm(channel("d1"), [casey, ada]), "u1")).toBe("Ada W.");
  });
});

describe("dmFaces", () => {
  it("is the other person in a 1:1", () => {
    expect(dmFaces(dm(channel("d1"), [casey, ada]), "u1")).toEqual([ada]);
  });

  it("is the first two others in a group", () => {
    expect(
      dmFaces(groupDm(channel("g1"), [casey, ada, bea, dee]), "u1"),
    ).toEqual([ada, bea]);
  });

  it("has nobody to show in an empty conversation", () => {
    expect(dmFaces(dm(channel("d1")), "u1")).toEqual([]);
  });
});

// The rail pill must equal the sum of the row badges: they used to count
// different things — conversations in the feed, messages on the row — and
// disagreed in plain sight.
describe("dmUnreadTotal", () => {
  it("adds up the messages, not the conversations", () => {
    expect(
      dmUnreadTotal([
        dm(unreadChannel("a", 4), [casey, ada]),
        dm(unreadChannel("b", 2), [casey, bea]),
      ]),
    ).toBe(6);
  });

  // A closed conversation has no row, so a count for it would point at
  // nothing that can be opened.
  it("skips a closed conversation until a message brings it back", () => {
    expect(
      dmUnreadTotal([
        { ...dm(unreadChannel("a", 4), [casey, ada]), closed: true },
        dm(unreadChannel("b", 2), [casey, bea]),
      ]),
    ).toBe(2);
  });

  it("skips a muted conversation, as its row skips the badge", () => {
    expect(
      dmUnreadTotal([
        dm(unreadChannel("a", 4), [casey, ada]),
        dm(unreadChannel("b", 9, true), [casey, bea]),
      ]),
    ).toBe(4);
  });

  it("is zero with nothing unread, and with nothing loaded", () => {
    expect(dmUnreadTotal([dm(unreadChannel("a", 0), [casey, ada])])).toBe(0);
    expect(dmUnreadTotal(undefined)).toBe(0);
  });
});

describe("dmPreview", () => {
  const said = (
    d: DirectMessage,
    from: MessageAuthor,
    preview: string,
    deleted = false,
  ): DirectMessage =>
    ({
      ...d,
      lastMessage: { author: from, preview, deleted },
    }) as unknown as DirectMessage;

  it("is the words alone from the other person in a 1:1", () => {
    expect(
      dmPreview(said(dm(channel("d1"), [casey, ada]), ada, "around?"), "u1"),
    ).toBe("around?");
  });

  it("says when it was you", () => {
    expect(
      dmPreview(said(dm(channel("d1"), [casey, ada]), casey, "thanks"), "u1"),
    ).toBe("You: thanks");
  });

  it("names who said it in a group", () => {
    expect(
      dmPreview(
        said(groupDm(channel("g1"), [casey, ada, bea]), bea, "snacks"),
        "u1",
      ),
    ).toBe("bea: snacks");
  });

  it("says a deleted message was deleted, whoever wrote it", () => {
    expect(
      dmPreview(said(dm(channel("d1"), [casey, ada]), casey, "", true), "u1"),
    ).toBe("Message deleted");
  });

  it("leaves a group's line unnamed when its sender isn't known", () => {
    const unknown = {
      id: "u9",
      username: "",
      displayName: "",
    } as MessageAuthor;
    expect(
      dmPreview(
        said(groupDm(channel("g1"), [casey, ada, bea]), unknown, "snacks"),
        "u1",
      ),
    ).toBe("snacks");
  });

  it("is empty with no message yet", () => {
    expect(dmPreview(dm(channel("d1"), [casey, ada]), "u1")).toBe("");
  });
});

describe("dmTime", () => {
  // Local time, and Intl output rather than English, as dates.test.ts.
  const at = (m: number, d: number, h = 12, y = 2026) =>
    new Date(y, m - 1, d, h, 0);
  const now = at(10, 30, 15); // a Friday afternoon

  it("is the time of day today", () => {
    const d = at(10, 30, 8);
    expect(dmTime(d, now)).toBe(
      d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    );
  });

  it("is the weekday within the week", () => {
    for (const d of [at(10, 29), at(10, 24, 9)]) {
      expect(dmTime(d, now)).toBe(
        d.toLocaleDateString([], { weekday: "short" }),
      );
    }
  });

  // Counted in calendar days: the night the clocks went back (Oct 25,
  // 2026 in much of Europe; Nov 1 in the US) doesn't move the cutoff.
  it("counts days by the calendar, from the very start of a day", () => {
    const fromMonday = at(10, 24, 0);
    expect(dmTime(fromMonday, now)).toBe(
      fromMonday.toLocaleDateString([], { weekday: "short" }),
    );
    const usNow = new Date(2026, 10, 6, 15, 0);
    const lastSaturday = new Date(2026, 9, 31, 0, 30);
    expect(dmTime(lastSaturday, usNow)).toBe(
      lastSaturday.toLocaleDateString([], { weekday: "short" }),
    );
  });

  it("is the date a week back, before the weekday repeats", () => {
    const d = at(10, 23);
    expect(dmTime(d, now)).toBe(
      d.toLocaleDateString([], { month: "short", day: "numeric" }),
    );
  });

  it("carries the year from another year", () => {
    const d = at(12, 31, 12, 2025);
    expect(dmTime(d, now)).toBe(
      d.toLocaleDateString([], {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    );
  });
});
