import { create } from "@bufbuild/protobuf";
import { ServerEventSchema, VoiceParticipantSchema } from "@stoop/gen/stoop/realtime/v1/realtime_pb";
import { describe, expect, it } from "vitest";
import { applyVoiceEvent, inRoom, type VoiceRoster } from "./voice";

const person = (userId: string, channelId: string, muted = false) =>
  create(VoiceParticipantSchema, { userId, channelId, muted });

const ready = (...participants: ReturnType<typeof person>[]) =>
  create(ServerEventSchema, { payload: { case: "ready", value: { voiceParticipants: participants } } });

const changed = (participant: ReturnType<typeof person>, joined: boolean) =>
  create(ServerEventSchema, { payload: { case: "voiceStateChanged", value: { participant, joined } } });

const ids = (roster: VoiceRoster | undefined, channelId: string) =>
  inRoom(roster, channelId).map((participant) => participant.userId);

// The order a room's people are in: what the Stage draws them in.
describe("a room's order", () => {
  const start = applyVoiceEvent(undefined, ready(person("u2", "porch"), person("u1", "porch"), person("u3", "attic")));

  it("is the server's on connecting", () => {
    expect(ids(start, "porch")).toEqual(["u2", "u1"]);
  });

  it("puts someone joining last", () => {
    expect(ids(applyVoiceEvent(start, changed(person("u0", "porch"), true)), "porch")).toEqual(["u2", "u1", "u0"]);
  });

  it("keeps someone's place when their state changes", () => {
    const muted = applyVoiceEvent(start, changed(person("u2", "porch", true), true));
    expect(ids(muted, "porch")).toEqual(["u2", "u1"]);
    expect(muted?.u2.muted).toBe(true);
  });

  it("puts someone coming from another room last", () => {
    const later = applyVoiceEvent(start, changed(person("u4", "porch"), true));
    expect(ids(applyVoiceEvent(later, changed(person("u3", "porch"), true)), "porch")).toEqual(["u2", "u1", "u4", "u3"]);
  });

  it("keeps everyone's place over a reconnect, whatever order the server lists them in", () => {
    const live = applyVoiceEvent(start, changed(person("u0", "porch"), true));
    const again = ready(person("u0", "porch"), person("u3", "attic"), person("u1", "porch", true), person("u2", "porch"));
    const back = applyVoiceEvent(undefined, again, live);
    expect(ids(back, "porch")).toEqual(["u2", "u1", "u0"]);
    expect(back?.u1.muted).toBe(true);
  });

  it("puts whoever joined or changed rooms while the socket was down after those who stayed", () => {
    const again = ready(person("u9", "porch"), person("u3", "porch"), person("u1", "porch"));
    expect(ids(applyVoiceEvent(undefined, again, start), "porch")).toEqual(["u1", "u9", "u3"]);
  });

  it("puts someone who left and came back last", () => {
    const left = applyVoiceEvent(start, changed(person("u2", "porch"), false));
    expect(ids(applyVoiceEvent(left, changed(person("u2", "porch"), true)), "porch")).toEqual(["u1", "u2"]);
  });
});
