import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it, vi } from "vitest";
import {
  dndActive,
  dndChoice,
  dndEnd,
  presenceClass,
  presenceLabel,
} from "./presence";

// api/clients.ts builds its transport from location.origin as it loads,
// and the unit suite runs in node.
vi.hoisted(() => {
  Object.assign(globalThis, { location: new URL("http://localhost:8091") });
});

const now = new Date("2026-09-15T12:00:00Z");
const at = (ms: number) => timestampFromDate(new Date(now.getTime() + ms));

describe("dndActive", () => {
  it("is off for no one and for someone not on it", () => {
    expect(dndActive(undefined, now)).toBe(false);
    expect(dndActive(null, now)).toBe(false);
    expect(dndActive({ dnd: false, dndUntil: undefined }, now)).toBe(false);
  });

  it("is on with no end", () => {
    expect(dndActive({ dnd: true, dndUntil: undefined }, now)).toBe(true);
  });

  // An end that has passed reads as off before the server says so.
  it("is on until its end, and off from then", () => {
    expect(dndActive({ dnd: true, dndUntil: at(60_000) }, now)).toBe(true);
    expect(dndActive({ dnd: true, dndUntil: at(0) }, now)).toBe(false);
    expect(dndActive({ dnd: true, dndUntil: at(-60_000) }, now)).toBe(false);
  });
});

describe("the do not disturb menu", () => {
  it("stands on off, never, or the end already chosen", () => {
    expect(dndChoice(undefined, now)).toBe("off");
    expect(dndChoice({ dnd: true, dndUntil: undefined }, now)).toBe("never");
    expect(dndChoice({ dnd: true, dndUntil: at(60_000) }, now)).toBe("until");
    expect(dndChoice({ dnd: true, dndUntil: at(-60_000) }, now)).toBe("off");
  });

  it("ends a duration that long from now, and never expire not at all", () => {
    const hour = 60 * 60 * 1000;
    expect(dndEnd("1h", now)).toEqual(new Date(now.getTime() + hour));
    expect(dndEnd("3h", now)).toEqual(new Date(now.getTime() + 3 * hour));
    expect(dndEnd("1d", now)).toEqual(new Date(now.getTime() + 24 * hour));
    expect(dndEnd("1w", now)).toEqual(new Date(now.getTime() + 168 * hour));
    expect(dndEnd("never", now)).toBeUndefined();
    expect(dndEnd("off", now)).toBeUndefined();
  });
});

describe("the dot", () => {
  it("shows do not disturb for someone online on it, and online otherwise", () => {
    expect(presenceClass(true)).toBe("dnd");
    expect(presenceClass(false)).toBe("online");
    expect(presenceClass(undefined)).toBe("online");
  });

  // Offline beats do not disturb: the dot is whether they can be reached.
  it("says offline whatever do not disturb says", () => {
    expect(presenceLabel(false, true)).toBe("offline");
    expect(presenceLabel(false, false)).toBe("offline");
    expect(presenceLabel(true, true)).toBe("do not disturb");
    expect(presenceLabel(true, false)).toBe("online");
    expect(presenceLabel(true, undefined)).toBe("online");
  });
});
