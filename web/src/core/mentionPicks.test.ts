import { describe, expect, it } from "vitest";
import type { Channel } from "../gen/stoop/chat/v1/channel_pb";
import type { Group } from "../gen/stoop/chat/v1/group_pb";
import type { Member } from "../gen/stoop/chat/v1/member_pb";
import { atReplace, pickedWords, pickReplace } from "./mentionPicks";
import { type MentionCandidate, mentionQueryAt } from "./mentions";

const ada = "0192f3a4-7b1c-7d2e-9f00-3c4d5e6f7a01";
const crew = "0192f3a4-7b1c-7d2e-9f00-3c4d5e6f7a03";
const garden = "0192f3a4-7b1c-7d2e-9f00-3c4d5e6f7a05";

const person: MentionCandidate = {
  kind: "member",
  member: { userId: ada, username: "Ada", displayName: "Ada W." } as Member,
};
const group: MentionCandidate = {
  kind: "group",
  group: { id: crew, handle: "gardeners", name: "Garden crew" } as Group,
};
const channel: MentionCandidate = {
  kind: "channel",
  channel: { id: garden, name: "garden" } as Channel,
};
const everyone: MentionCandidate = {
  kind: "member",
  member: { userId: "channel", username: "channel" } as Member,
};

describe("pickedWords", () => {
  it("is the token, or the words @channel and @here are sent as", () => {
    expect(pickedWords(person)).toBe(`<@u:${ada}:ada>`);
    expect(pickedWords(group)).toBe(`<@g:${crew}:gardeners>`);
    expect(pickedWords(channel)).toBe(`<#${garden}:garden>`);
    expect(pickedWords(everyone)).toBe("@channel");
  });
});

describe("pickReplace", () => {
  it("replaces the query with a pill for the pick and a space", () => {
    expect(pickReplace("hi @ad", 3, person)).toEqual({
      count: 3,
      text: " ",
      mention: { kind: "person", id: ada, handle: "ada" },
    });
    expect(pickReplace("see #ga", 4, channel)).toEqual({
      count: 3,
      text: " ",
      mention: { kind: "channel", id: garden, handle: "garden" },
    });
  });

  it("writes @channel as words", () => {
    expect(pickReplace("@ch", 0, everyone)).toEqual({
      count: 3,
      text: "@channel ",
    });
  });
});

describe("atReplace", () => {
  it("puts an @ at the caret that starts a query", () => {
    expect(atReplace("")).toEqual({ count: 0, text: "@" });
    expect(atReplace("hi ")).toEqual({ count: 0, text: "@" });
  });

  it("puts a space first where the @ would run into a word", () => {
    const { text } = atReplace("cc");
    expect(text).toBe(" @");
    expect(mentionQueryAt(`cc${text}`, 4)).toEqual({ start: 3, query: "" });
    expect(atReplace("@").text).toBe(" @");
  });
});
