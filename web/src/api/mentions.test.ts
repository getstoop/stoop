import { describe, expect, it } from "vitest";
import type { Member } from "../gen/stoop/chat/v1/member_pb";
import {
  filterMembers,
  mentionNotes,
  mentionQueryAt,
  splitMentions,
} from "./mentions";

const member = (username: string, displayName = ""): Member =>
  ({ userId: username, username, displayName }) as Member;

const members = [
  member("casey", "Casey Q."),
  member("ada", "Ada W."),
  member("bea"),
  member("cal", "Callisto"),
];

const known = new Set(["casey", "ada", "bea", "cal", "ada_w"]);

describe("mentionQueryAt", () => {
  it("reads the handle being typed at the caret", () => {
    expect(mentionQueryAt("hi @be", 6)).toEqual({ start: 3, query: "be" });
  });

  it("opens on the bare @ with an empty query", () => {
    expect(mentionQueryAt("hi @", 4)).toEqual({ start: 3, query: "" });
  });

  it("takes an @ at the very start of the message", () => {
    expect(mentionQueryAt("@ad", 3)).toEqual({ start: 0, query: "ad" });
  });

  it("ignores everything after the caret", () => {
    expect(mentionQueryAt("hi @be there", 6)).toEqual({
      start: 3,
      query: "be",
    });
  });

  it("closes once the word ends", () => {
    expect(mentionQueryAt("hi @ada bea", 11)).toBeNull();
    expect(mentionQueryAt("hi @ada. bea", 12)).toBeNull();
  });

  it("finds nothing when there is no @ before the caret", () => {
    expect(mentionQueryAt("hi there", 8)).toBeNull();
    expect(mentionQueryAt("@ada", 0)).toBeNull();
  });

  it("does not open inside an email address", () => {
    expect(mentionQueryAt("mail casey@example", 18)).toBeNull();
    expect(mentionQueryAt("mail casey@", 11)).toBeNull();
  });

  it("does not open on a second @ stuck to the first", () => {
    expect(mentionQueryAt("@@ada", 5)).toBeNull();
  });

  it("opens after punctuation and after a newline", () => {
    expect(mentionQueryAt("(@ada", 5)).toEqual({ start: 1, query: "ada" });
    expect(mentionQueryAt("hi\n@ada", 7)).toEqual({ start: 3, query: "ada" });
  });

  it("keeps the underscore that handles allow", () => {
    expect(mentionQueryAt("@ada_w", 6)).toEqual({ start: 0, query: "ada_w" });
  });

  // The query is not length-capped the way a handle is; the picker simply
  // matches nobody once it runs past every name.
  it("hands back a query longer than a handle may be", () => {
    const long = "a".repeat(40);
    expect(mentionQueryAt(`@${long}`, 41)).toEqual({ start: 0, query: long });
  });
});

describe("filterMembers", () => {
  it("matches either name by prefix, case-insensitively", () => {
    expect(filterMembers(members, "CA").map((m) => m.username)).toEqual([
      "casey",
      "cal",
    ]);
    expect(filterMembers(members, "callis").map((m) => m.username)).toEqual([
      "cal",
    ]);
  });

  it("matches the start of a name only, not the middle", () => {
    expect(filterMembers(members, "sey")).toEqual([]);
  });

  it("keeps the server's order and returns everyone for an empty query", () => {
    expect(filterMembers(members, "").map((m) => m.username)).toEqual([
      "casey",
      "ada",
      "bea",
      "cal",
    ]);
  });

  it("leaves out @channel and @here unless the caller may use them", () => {
    expect(filterMembers(members, "h").map((m) => m.username)).toEqual([]);
    expect(filterMembers(members, "h", true).map((m) => m.username)).toEqual([
      "here",
    ]);
  });

  it("puts @channel and @here ahead of the members", () => {
    expect(filterMembers(members, "", true).map((m) => m.username)).toEqual([
      "channel",
      "here",
      "casey",
      "ada",
      "bea",
      "cal",
    ]);
  });

  it("labels the two broadcast rows for the picker", () => {
    const [channel, here] = filterMembers([], "", true);
    expect(channel.displayName).toBe("Everyone in this channel");
    expect(here.displayName).toBe("Everyone here who is online");
  });

  it("lists a member once even when both names match", () => {
    expect(filterMembers([member("ada", "adamant")], "ad")).toHaveLength(1);
  });

  it("caps the picker at eight rows", () => {
    const many = Array.from({ length: 20 }, (_, i) => member(`ada${i}`));
    expect(filterMembers(many, "ada")).toHaveLength(8);
    // @channel and @here spend two of the eight.
    expect(filterMembers(many, "", true).slice(2)).toHaveLength(6);
  });
});

describe("splitMentions", () => {
  it("returns nothing for an empty message", () => {
    expect(splitMentions("", known)).toEqual([]);
  });

  it("leaves a message without mentions in one piece", () => {
    expect(splitMentions("hello there", known)).toEqual([
      { text: "hello there" },
    ]);
  });

  it("marks a handle that belongs to a member", () => {
    expect(splitMentions("hi @ada!", known)).toEqual([
      { text: "hi " },
      { text: "@ada", mention: "ada" },
      { text: "!" },
    ]);
  });

  it("keeps the typed case in the text and lowercases the mention", () => {
    expect(splitMentions("@Ada", known)).toEqual([
      { text: "@Ada", mention: "ada" },
    ]);
  });

  it("marks each of several mentions", () => {
    expect(splitMentions("@ada and @bea", known)).toEqual([
      { text: "@ada", mention: "ada" },
      { text: " and " },
      { text: "@bea", mention: "bea" },
    ]);
  });

  it("leaves a handle nobody holds as plain text", () => {
    expect(splitMentions("hi @nobody", known)).toEqual([
      { text: "hi @nobody" },
    ]);
  });

  it("does not mention out of an email address", () => {
    expect(splitMentions("mail casey@example.com", known)).toEqual([
      { text: "mail casey@example.com" },
    ]);
  });

  it("needs three characters, so a short handle never mentions", () => {
    expect(splitMentions("@cy", new Set(["cy"]))).toEqual([{ text: "@cy" }]);
  });

  it("stops the handle at punctuation but keeps the underscore", () => {
    expect(splitMentions("@ada_w's turn", known)).toEqual([
      { text: "@ada_w", mention: "ada_w" },
      { text: "'s turn" },
    ]);
    expect(splitMentions("(@bea)", known)).toEqual([
      { text: "(" },
      { text: "@bea", mention: "bea" },
      { text: ")" },
    ]);
  });

  // The second @ is not a boundary the token rule accepts, so only the
  // first handle in a run is a mention.
  it("takes only the first handle when two are stuck together", () => {
    expect(splitMentions("@ada@bea", known)).toEqual([
      { text: "@ada", mention: "ada" },
      { text: "@bea" },
    ]);
  });

  it("mentions an old @everyone and @here only when the message carries them", () => {
    expect(splitMentions("@everyone", known)).toEqual([{ text: "@everyone" }]);
    expect(splitMentions("@everyone", known, true)).toEqual([
      { text: "@everyone", mention: "everyone" },
    ]);
    expect(splitMentions("@here", known, true)).toEqual([{ text: "@here" }]);
    expect(splitMentions("@here", known, false, true)).toEqual([
      { text: "@here", mention: "here" },
    ]);
  });

  it("mentions @channel only when the message carries it", () => {
    expect(splitMentions("@channel", known)).toEqual([{ text: "@channel" }]);
    expect(splitMentions("@channel", known, false, false, true)).toEqual([
      { text: "@channel", mention: "channel" },
    ]);
  });

  it("takes @Everyone written in any case", () => {
    expect(splitMentions("@Everyone", known, true)).toEqual([
      { text: "@Everyone", mention: "everyone" },
    ]);
  });

  it("keeps the text either side of a skipped handle intact", () => {
    expect(splitMentions("a @nobody b @ada c", known)).toEqual([
      { text: "a @nobody b " },
      { text: "@ada", mention: "ada" },
      { text: " c" },
    ]);
  });

  // The token regex is module-level and global; matchAll must not leave
  // lastIndex behind for the next message.
  it("gives the same answer on a second pass", () => {
    const once = splitMentions("hi @ada", known);
    expect(splitMentions("hi @ada", known)).toEqual(once);
  });
});

describe("mentionNotes", () => {
  const inside = new Set(["me", "ada", "bea"]);
  const online = new Set(["me", "bea", "cal"]);
  const row = (userId: string) => ({ userId }) as Member;
  const notes = (...ids: string[]) =>
    mentionNotes(ids.map(row), "garden", inside, online, "me");

  it("counts the others @channel and @here reach in the channel", () => {
    const found = notes("channel", "here");
    expect(found.get("channel")).toBe("2 people");
    expect(found.get("here")).toBe("1 person");
  });

  it("says a name outside the channel will be added, and nothing otherwise", () => {
    const found = notes("ada", "cal");
    expect(found.has("ada")).toBe(false);
    expect(found.get("cal")).toBe("Not in #garden, will be added");
  });

  it("says nothing beside the caller's own name", () => {
    expect(
      mentionNotes([row("me")], "garden", new Set(), online, "me").size,
    ).toBe(0);
  });
});
