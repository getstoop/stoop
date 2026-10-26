import { describe, expect, it } from "vitest";
import type { Channel } from "../gen/stoop/chat/v1/channel_pb";
import type { Group } from "../gen/stoop/chat/v1/group_pb";
import type { Member } from "../gen/stoop/chat/v1/member_pb";
import { pickedWords, withAt, withPick } from "./mentionPicks";
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

describe("withPick", () => {
  it("replaces the query with the pick and a space, caret after", () => {
    const text = "hi @ad";
    expect(withPick(text, 3, 6, person)).toEqual({
      text: `hi <@u:${ada}:ada> `,
      caret: 3 + `<@u:${ada}:ada> `.length,
    });
  });

  it("keeps what follows the caret", () => {
    expect(withPick("see #ga then", 4, 7, channel)).toEqual({
      text: `see <#${garden}:garden>  then`,
      caret: 4 + `<#${garden}:garden> `.length,
    });
  });

  it("writes @channel as words", () => {
    expect(withPick("@ch", 0, 3, everyone)).toEqual({
      text: "@channel ",
      caret: 9,
    });
  });
});

describe("withAt", () => {
  it("puts an @ at the caret that starts a query", () => {
    expect(withAt("", 0)).toEqual({ text: "@", caret: 1 });
    expect(withAt("hi ", 3)).toEqual({ text: "hi @", caret: 4 });
    expect(withAt("hi  there", 3)).toEqual({ text: "hi @ there", caret: 4 });
  });

  it("puts a space first where the @ would run into a word", () => {
    const edited = withAt("cc", 2);
    expect(edited).toEqual({ text: "cc @", caret: 4 });
    expect(mentionQueryAt(edited.text, edited.caret)).toEqual({
      start: 3,
      query: "",
    });
    expect(withAt("hi there", 2)).toEqual({ text: "hi @ there", caret: 4 });
    expect(withAt("@", 1)).toEqual({ text: "@ @", caret: 3 });
  });
});
