import type { ServerEvent } from "@stoop/gen/stoop/realtime/v1/realtime_pb";
import { describe, expect, it } from "vitest";
import { touchesSpace } from "./channels";
import { touchesSpaces } from "./spaces";

const event = (kind: string, value: object = {}): ServerEvent => ({ payload: { case: kind, value } }) as ServerEvent;

describe("touchesSpaces", () => {
  it("reloads on a reconnect and on a space joined", () => {
    expect(touchesSpaces(event("ready"))).toBe(true);
    expect(touchesSpaces(event("spaceJoined", { space: { id: "books" } }))).toBe(true);
  });

  it("reloads on what changes any space's channels, members or the space", () => {
    for (const kind of ["messageCreated", "channelRead", "spaceMuted", "spaceDeleted", "memberRemoved"]) {
      expect(touchesSpaces(event(kind, { spaceId: "books" }))).toBe(true);
    }
    expect(touchesSpaces(event("spaceUpdated", { space: { id: "books" } }))).toBe(true);
  });

  it("leaves direct messages and other kinds alone", () => {
    expect(touchesSpaces(event("messageCreated", { spaceId: "" }))).toBe(false);
    expect(touchesSpaces(event("channelRead", { spaceId: "" }))).toBe(false);
    expect(touchesSpaces(event("presenceChanged", { userId: "ada" }))).toBe(false);
    expect(touchesSpaces(event("voiceStateChanged", { spaceId: "books" }))).toBe(false);
  });
});

describe("touchesSpace", () => {
  it("is for the one space, and a reconnect", () => {
    expect(touchesSpace(event("ready"), "books")).toBe(true);
    expect(touchesSpace(event("messageCreated", { spaceId: "books" }), "books")).toBe(true);
    expect(touchesSpace(event("messageCreated", { spaceId: "climbing" }), "books")).toBe(false);
    expect(touchesSpace(event("spaceUpdated", { space: { id: "books" } }), "books")).toBe(true);
    expect(touchesSpace(event("spaceJoined", { space: { id: "books" } }), "books")).toBe(false);
  });
});
