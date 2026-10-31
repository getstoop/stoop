import { create } from "@bufbuild/protobuf";
import {
  PresenceChangedSchema,
  ReadySchema,
  type ServerEvent,
  ServerEventSchema,
  UserPresenceSchema,
} from "@stoop/gen/stoop/realtime/v1/realtime_pb";
import { describe, expect, it } from "vitest";
import { applyPresenceEvent } from "./presence";

const ready = (...people: { userId: string; dnd?: boolean; mobile?: boolean }[]): ServerEvent =>
  create(ServerEventSchema, {
    payload: {
      case: "ready",
      value: create(ReadySchema, { presences: people.map((person) => create(UserPresenceSchema, person)) }),
    },
  });

const changed = (userId: string, online: boolean, dnd = false, mobile = false): ServerEvent =>
  create(ServerEventSchema, {
    payload: { case: "presenceChanged", value: create(PresenceChangedSchema, { userId, online, dnd, mobile }) },
  });

describe("applyPresenceEvent", () => {
  it("starts from Ready, replacing whatever was held", () => {
    const old = { gone: { dnd: false, mobile: false } };
    expect(applyPresenceEvent(old, ready({ userId: "sam" }, { userId: "june", dnd: true, mobile: true }))).toEqual({
      sam: { dnd: false, mobile: false },
      june: { dnd: true, mobile: true },
    });
  });

  it("adds someone who comes online and drops someone who goes offline", () => {
    const roster = applyPresenceEvent({}, changed("sam", true, false, true));
    expect(roster).toEqual({ sam: { dnd: false, mobile: true } });
    expect(applyPresenceEvent(roster, changed("sam", false))).toEqual({});
  });

  it("follows do not disturb and mobile while online", () => {
    const roster = { sam: { dnd: false, mobile: false } };
    expect(applyPresenceEvent(roster, changed("sam", true, true))).toEqual({ sam: { dnd: true, mobile: false } });
  });

  it("hands back the same roster when nothing changed", () => {
    const roster = { sam: { dnd: false, mobile: false } };
    expect(applyPresenceEvent(roster, changed("sam", true))).toBe(roster);
    expect(applyPresenceEvent(roster, changed("june", false))).toBe(roster);
  });

  // Before Ready nobody can say who is online, so a change can't be
  // placed into a list that doesn't exist yet.
  it("stays unknown until Ready", () => {
    expect(applyPresenceEvent(undefined, changed("sam", true))).toBeUndefined();
  });
});
