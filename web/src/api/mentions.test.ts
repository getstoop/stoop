import { describe, expect, it } from "vitest";
import type { Group } from "../gen/stoop/chat/v1/group_pb";
import type { Member } from "../gen/stoop/chat/v1/member_pb";
import {
  candidateText,
  filterMembers,
  groupMentionClass,
  mentionCandidates,
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

  it("opens a group query on @@", () => {
    expect(mentionQueryAt("@@ga", 4)).toEqual({
      start: 0,
      query: "ga",
      group: true,
    });
    expect(mentionQueryAt("hi @@", 5)).toEqual({
      start: 3,
      query: "",
      group: true,
    });
  });

  it("does not open on a third @ or on @@ stuck to a word", () => {
    expect(mentionQueryAt("@@@ga", 5)).toBeNull();
    expect(mentionQueryAt("mail casey@@ga", 14)).toBeNull();
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
    expect(filterMembers(members, "ch").map((m) => m.username)).toEqual([]);
    expect(filterMembers(members, "ch", true).map((m) => m.username)).toEqual([
      "channel",
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
    expect(here.displayName).toBe("Everyone online in this channel");
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

  it("mentions @channel and @here only when the message carries them", () => {
    expect(splitMentions("@channel", known)).toEqual([{ text: "@channel" }]);
    expect(splitMentions("@channel", known, true)).toEqual([
      { text: "@channel", mention: "channel" },
    ]);
    expect(splitMentions("@here", known, true)).toEqual([{ text: "@here" }]);
    expect(splitMentions("@here", known, false, true)).toEqual([
      { text: "@here", mention: "here" },
    ]);
  });

  it("takes @Channel written in any case", () => {
    expect(splitMentions("@Channel", known, true)).toEqual([
      { text: "@Channel", mention: "channel" },
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

const group = (handle: string, name: string, userIds: string[] = []): Group =>
  ({ id: handle, handle, name, userIds }) as unknown as Group;

const groups = new Set(["gardeners", "ada"]);

describe("splitMentions with groups", () => {
  it("marks an @@handle that names a group", () => {
    expect(
      splitMentions("hi @@Gardeners!", known, false, false, groups),
    ).toEqual([
      { text: "hi " },
      { text: "@@Gardeners", mention: "gardeners", group: true },
      { text: "!" },
    ]);
  });

  it("tells a person from a group with the same handle", () => {
    expect(splitMentions("@ada @@ada", known, false, false, groups)).toEqual([
      { text: "@ada", mention: "ada" },
      { text: " " },
      { text: "@@ada", mention: "ada", group: true },
    ]);
  });

  it("leaves @@handle plain where no group has it, or groups do nothing", () => {
    expect(splitMentions("@@nobody", known, false, false, groups)).toEqual([
      { text: "@@nobody" },
    ]);
    expect(splitMentions("@@gardeners", known)).toEqual([
      { text: "@@gardeners" },
    ]);
  });

  it("never reads @@channel as @channel", () => {
    expect(splitMentions("@@channel", known, true, true, groups)).toEqual([
      { text: "@@channel" },
    ]);
  });
});

describe("mentionCandidates", () => {
  const crew = group("gardeners", "Garden crew");
  const captains = group("watch_captains", "Watch captains");

  it("puts @channel first, then groups, then people", () => {
    const rows = mentionCandidates(members, [crew, captains], "", {
      channelAndHere: true,
    });
    expect(rows.slice(0, 5).map((row) => row.kind)).toEqual([
      "member",
      "member",
      "group",
      "group",
      "member",
    ]);
    expect(candidateText(rows[0])).toBe("@channel ");
    expect(candidateText(rows[2])).toBe("@@gardeners ");
  });

  it("matches a group on its handle or its name", () => {
    expect(mentionCandidates([], [crew, captains], "gard")).toHaveLength(1);
    expect(mentionCandidates([], [crew, captains], "watch")).toHaveLength(1);
    expect(mentionCandidates([], [crew, captains], "garden c")).toHaveLength(1);
  });

  it("offers groups alone after @@", () => {
    const rows = mentionCandidates(members, [crew], "", {
      channelAndHere: true,
      groupsOnly: true,
    });
    expect(rows.map((row) => row.kind)).toEqual(["group"]);
  });
});

describe("groupMentionClass", () => {
  it("fills the pill for someone in the group", () => {
    const crew = group("gardeners", "Garden crew", ["me-id"]);
    expect(groupMentionClass(crew, "me-id")).toBe("mention group me");
    expect(groupMentionClass(crew, "other")).toBe("mention group");
    expect(groupMentionClass(undefined, "me-id")).toBe("mention group");
  });
});
