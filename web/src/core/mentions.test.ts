import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { type Channel, ChannelKind } from "../gen/stoop/chat/v1/channel_pb";
import type { Group } from "../gen/stoop/chat/v1/group_pb";
import type { Member } from "../gen/stoop/chat/v1/member_pb";
import { MessageSchema } from "../gen/stoop/chat/v1/message_pb";
import {
  candidateMention,
  channelCandidates,
  channelQueryAt,
  currentHandle,
  filterMembers,
  linkableChannels,
  mentionCandidates,
  mentionGroups,
  mentionMembers,
  mentionQueryAt,
  mentionsMe,
  mentionToken,
  mentionTokenAt,
  soleChannel,
  soleMention,
  splitEveryone,
  tokensAsText,
  withTypedMentions,
} from "./mentions";

const member = (username: string, displayName = ""): Member =>
  ({ userId: username, username, displayName }) as Member;

const group = (handle: string, name: string, userIds: string[] = []): Group =>
  ({ id: handle, handle, name, userIds }) as unknown as Group;

const members = [
  member("casey", "Casey Q."),
  member("ada", "Ada W."),
  member("bea"),
  member("cal", "Callisto"),
];

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

  it("does not open on @@", () => {
    expect(mentionQueryAt("@@ga", 4)).toBeNull();
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

describe("mention tokens", () => {
  const id = "0192f3a4-7b1c-7d2e-9f00-3c4d5e6f7a8b";

  it("reads and writes a person and a group", () => {
    expect(mentionTokenAt(`<@u:${id}:casey> hi`)).toEqual({
      mention: { kind: "person", id, handle: "casey" },
      length: 47,
    });
    expect(mentionToken({ kind: "group", id, handle: "crew" })).toBe(
      `<@g:${id}:crew>`,
    );
  });

  it("refuses what isn't one", () => {
    expect(mentionTokenAt(`hi <@u:${id}:casey>`)).toBeNull();
    expect(mentionTokenAt("<@u:not-an-id:casey>")).toBeNull();
    expect(mentionTokenAt(`<@x:${id}:casey>`)).toBeNull();
  });
});

describe("channel links", () => {
  const id = "0192f3a4-7b1c-7d2e-9f00-3c4d5e6f7a8b";
  const channel = (name: string, fields: Partial<Channel> = {}): Channel =>
    ({
      id: name,
      name,
      kind: ChannelKind.TEXT,
      private: false,
      ...fields,
    }) as Channel;
  const linkable = linkableChannels([
    channel("garden"),
    channel("gardening-club"),
    channel("secret", { private: true }),
    channel("porch", { kind: ChannelKind.VOICE }),
    channel("Off Topic"),
  ]);

  it("reads and writes a channel token", () => {
    expect(mentionTokenAt(`<#${id}:off-topic> hi`)).toEqual({
      mention: { kind: "channel", id, handle: "off-topic" },
      length: 49,
    });
    expect(mentionToken({ kind: "channel", id, handle: "garden" })).toBe(
      `<#${id}:garden>`,
    );
    expect(mentionTokenAt(`<#${id}:Garden>`)).toBeNull();
    expect(mentionTokenAt(`<@c:${id}:garden>`)).toBeNull();
    expect(tokensAsText(`<#${id}:garden> and <@u:${id}:casey>`)).toBe(
      "#garden and @casey",
    );
  });

  it("links public text channels whose names a token can carry", () => {
    expect([...linkable.keys()]).toEqual(["garden", "gardening-club"]);
  });

  it("reads the #query at the caret", () => {
    expect(channelQueryAt("see #gar", 8)).toEqual({ start: 4, query: "gar" });
    expect(channelQueryAt("#", 1)).toEqual({ start: 0, query: "" });
    expect(channelQueryAt("see #off-to", 11)?.query).toBe("off-to");
    expect(channelQueryAt("C#", 2)).toBeNull();
    expect(channelQueryAt("https://a.example/#top", 22)).toBeNull();
    expect(channelQueryAt("https://a.example/?#garden", 26)).toBeNull();
    expect(channelQueryAt("https://a.example/ #gar", 23)?.query).toBe("gar");
    expect(channelQueryAt("#garden now", 11)).toBeNull();
  });

  it("offers channels by name, and names one typed in full", () => {
    expect(
      channelCandidates(linkable, "Gard").map(
        (candidate) => candidate.kind === "channel" && candidate.channel.name,
      ),
    ).toEqual(["garden", "gardening-club"]);
    const [first] = channelCandidates(linkable, "garden");
    expect(candidateMention(first)).toEqual({
      kind: "channel",
      id: "garden",
      handle: "garden",
    });
    expect(soleChannel("Garden", linkable)?.id).toBe("garden");
    expect(soleChannel("secret", linkable)).toBeNull();
  });

  it("reads a channel's current name, or null when it can't be linked", () => {
    const ref = { kind: "channel" as const, id: "garden", handle: "old" };
    expect(currentHandle(ref, new Map(), new Map(), linkable)).toBe("garden");
    expect(currentHandle(ref, new Map(), new Map())).toBeNull();
  });
});

describe("soleMention and currentHandle", () => {
  const people = mentionMembers(members);
  const crew = mentionGroups([group("gardeners", "Garden crew")]);

  it("names the one person or group with the handle", () => {
    expect(soleMention("Casey", people, crew)).toEqual({
      kind: "person",
      id: "casey",
      handle: "casey",
    });
    expect(soleMention("gardeners", people, crew)?.kind).toBe("group");
    expect(soleMention("nobody", people, crew)).toBeNull();
    expect(soleMention("channel", people, crew)).toBeNull();
  });

  it("names nobody when a person and a group share it", () => {
    expect(
      soleMention("bea", people, mentionGroups([group("bea", "Not Bea")])),
    ).toBeNull();
  });

  it("reads the current handle, or null when it can't be found", () => {
    expect(
      currentHandle({ kind: "person", id: "ada", handle: "old" }, people, crew),
    ).toBe("ada");
    expect(
      currentHandle(
        { kind: "person", id: "gone", handle: "old" },
        people,
        crew,
      ),
    ).toBeNull();
  });
});

describe("withTypedMentions", () => {
  const ada = "0192f3a4-7b1c-7d2e-9f00-3c4d5e6f7a01";
  const bea = "0192f3a4-7b1c-7d2e-9f00-3c4d5e6f7a02";
  const crew = "0192f3a4-7b1c-7d2e-9f00-3c4d5e6f7a03";
  const twin = "0192f3a4-7b1c-7d2e-9f00-3c4d5e6f7a04";
  const garden = "0192f3a4-7b1c-7d2e-9f00-3c4d5e6f7a05";
  const names = {
    members: mentionMembers([
      { userId: ada, username: "Ada", displayName: "Ada W." } as Member,
      { userId: bea, username: "bea", displayName: "" } as Member,
    ]),
    groups: mentionGroups([
      { id: crew, handle: "gardeners", name: "Garden crew" } as Group,
      { id: twin, handle: "bea", name: "Not Bea" } as Group,
    ]),
    channels: linkableChannels([
      { id: garden, name: "garden", kind: ChannelKind.TEXT } as Channel,
    ]),
  };
  const typed = (text: string) => withTypedMentions(text, names);

  it("writes a handle with one owner as its token", () => {
    expect(typed("@ada hi")).toBe(`<@u:${ada}:ada> hi`);
    expect(typed("hi @ADA.")).toBe(`hi <@u:${ada}:ada>.`);
    expect(typed("ask @gardeners")).toBe(`ask <@g:${crew}:gardeners>`);
    expect(typed("see #garden, then")).toBe(`see <#${garden}:garden>, then`);
    expect(typed("@ada\n@gardeners")).toBe(
      `<@u:${ada}:ada>\n<@g:${crew}:gardeners>`,
    );
  });

  it("leaves words that name nobody, or more than one", () => {
    expect(typed("@nobody and #nowhere")).toBe("@nobody and #nowhere");
    expect(typed("@bea, a person and a group")).toBe(
      "@bea, a person and a group",
    );
    expect(typed("@channel and @here")).toBe("@channel and @here");
  });

  it("leaves a handle that runs into a word", () => {
    expect(typed("ada@ada.example")).toBe("ada@ada.example");
    expect(typed("@adam")).toBe("@adam");
    expect(typed("C#garden")).toBe("C#garden");
  });

  it("leaves web addresses and the tokens already there", () => {
    expect(typed("https://a.example/@ada?#garden")).toBe(
      "https://a.example/@ada?#garden",
    );
    const picked = `<@u:${ada}:ada> and <#${garden}:garden>`;
    expect(typed(picked)).toBe(picked);
    expect(typed(`${picked} @ada`)).toBe(`${picked} <@u:${ada}:ada>`);
  });
});

describe("splitEveryone", () => {
  it("marks @channel and @here only when the message used them", () => {
    expect(splitEveryone("@channel and @here", false, false)).toEqual([
      { text: "@channel and @here" },
    ]);
    expect(splitEveryone("hi @Channel!", true)).toEqual([
      { text: "hi " },
      { text: "@Channel", everyone: true },
      { text: "!" },
    ]);
    expect(splitEveryone("mail me@here.org", true, true)).toEqual([
      { text: "mail me@here.org" },
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
    expect(candidateMention(rows[0])).toBeNull();
    expect(candidateMention(rows[2])).toEqual({
      kind: "group",
      id: crew.id,
      handle: "gardeners",
    });
  });

  it("matches a group on its handle or its name", () => {
    expect(mentionCandidates([], [crew, captains], "gard")).toHaveLength(1);
    expect(mentionCandidates([], [crew, captains], "watch")).toHaveLength(1);
    expect(mentionCandidates([], [crew, captains], "garden c")).toHaveLength(1);
  });
});

describe("mentionsMe", () => {
  const message = (init: MessageInitShape<typeof MessageSchema>) =>
    create(MessageSchema, { id: "01", channelId: "c1", ...init });

  it("is a mention of the reader by someone else, or @here", () => {
    expect(mentionsMe(message({ mentionUserIds: ["me"] }), "me")).toBe(true);
    expect(mentionsMe(message({ mentionsHere: true }), "me")).toBe(true);
    expect(
      mentionsMe(
        message({ mentionUserIds: ["me"], author: { id: "me" } }),
        "me",
      ),
    ).toBe(false);
    expect(mentionsMe(message({}), "me")).toBe(false);
  });
});
