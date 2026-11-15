import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { ChannelSchema } from "@stoop/gen/stoop/chat/v1/channel_pb";
import { MessageSchema } from "@stoop/gen/stoop/chat/v1/message_pb";
import {
  ChannelDeletedSchema,
  ChannelMutedSchema,
  ChannelReadSchema,
  MemberUpdatedSchema,
  ServerEventSchema,
  SpaceMutedSchema,
} from "@stoop/gen/stoop/realtime/v1/realtime_pb";
import { describe, expect, it } from "vitest";
import { hereLine, roomAbout, stageLayout, stagePeople, tileLabel, touchesRoom } from "./stageRules";

describe("stagePeople", () => {
  const members = {
    u1: { displayName: "Priya Shah", username: "priya", avatarFileId: "f1" },
    u2: { displayName: "", username: "theo", avatarFileId: "" },
  };

  it("names each person as the member list has them, in the roster's order", () => {
    expect(
      stagePeople(
        [
          { userId: "u2", muted: true },
          { userId: "u1", muted: false },
        ],
        members,
      ),
    ).toEqual([
      { userId: "u2", name: "theo", avatarFileId: "", muted: true },
      { userId: "u1", name: "Priya Shah", avatarFileId: "f1", muted: false },
    ]);
  });

  it("calls someone the member list doesn't have Someone", () => {
    expect(stagePeople([{ userId: "u9", muted: false }], members)).toEqual([
      { userId: "u9", name: "Someone", avatarFileId: "", muted: false },
    ]);
  });
});

describe("touchesRoom", () => {
  const event = (payload: MessageInitShape<typeof ServerEventSchema>["payload"]) =>
    create(ServerEventSchema, { payload });

  it.each([
    ["the room renamed", { case: "channelUpdated", value: create(ChannelSchema, { spaceId: "s1" }) }],
    ["a channel deleted", { case: "channelDeleted", value: create(ChannelDeletedSchema, { spaceId: "s1" }) }],
    ["a channel muted", { case: "channelMuted", value: create(ChannelMutedSchema, { spaceId: "s1" }) }],
    ["the space muted", { case: "spaceMuted", value: create(SpaceMutedSchema, { spaceId: "s1" }) }],
    ["the space renamed", { case: "spaceUpdated", value: { space: { id: "s1" } } }],
    ["a member's name changed", { case: "memberUpdated", value: create(MemberUpdatedSchema, { spaceId: "s1" }) }],
    ["a reconnect", { case: "ready", value: {} }],
  ] as const)("reloads on %s", (_name, payload) => {
    expect(touchesRoom(event(payload), "s1")).toBe(true);
  });

  it.each([
    ["a message", { case: "messageCreated", value: create(MessageSchema, { spaceId: "s1" }) }],
    ["a channel read", { case: "channelRead", value: create(ChannelReadSchema, { spaceId: "s1" }) }],
    ["another space's channel", { case: "channelUpdated", value: create(ChannelSchema, { spaceId: "s2" }) }],
    ["another space", { case: "spaceUpdated", value: { space: { id: "s2" } } }],
  ] as const)("leaves %s", (_name, payload) => {
    expect(touchesRoom(event(payload), "s1")).toBe(false);
  });
});

describe("stageLayout", () => {
  it.each([
    [1, { columns: 1, size: "tall" }],
    [2, { columns: 1, size: "tall" }],
    [3, { columns: 2, size: "regular" }],
    [4, { columns: 2, size: "regular" }],
    [5, { columns: 2, size: "small" }],
    [8, { columns: 2, size: "small" }],
  ] as const)("lays %i out", (count, layout) => {
    expect(stageLayout(count)).toEqual(layout);
  });
});

describe("roomAbout", () => {
  it("says the space and how many are here", () => {
    expect(roomAbout("Neighbors", 3)).toBe("Neighbors · 3 here");
    expect(roomAbout("Neighbors", 0)).toBe("Neighbors · 0 here");
  });

  it("says only the space while the roster isn't known", () => {
    expect(roomAbout("Neighbors", undefined)).toBe("Neighbors");
  });
});

describe("hereLine", () => {
  it.each([
    [[], ""],
    [["Priya"], "Priya is here"],
    [["Priya", "Theo"], "Priya and Theo are here"],
    [["Priya", "Theo", "Sam"], "Priya, Theo and Sam are here"],
    [["Priya", "Theo", "Sam", "Maya"], "Priya, Theo and 2 others are here"],
    [["Priya", "Theo", "Sam", "Maya", "Ines", "Jonah", "Rosa", "Kit"], "Priya, Theo and 6 others are here"],
  ])("names %j", (names, line) => {
    expect(hereLine(names)).toBe(line);
  });
});

describe("tileLabel", () => {
  it("says the name, and muted for someone muted", () => {
    expect(tileLabel({ name: "Priya Shah", muted: false })).toBe("Priya Shah");
    expect(tileLabel({ name: "Theo Lang", muted: true })).toBe("Theo Lang, muted");
  });
});
