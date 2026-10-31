import { describe, expect, it } from "vitest";
import { presenceClass, presenceLabel } from "./presence";

describe("the dot", () => {
  it("shows do not disturb for someone online on it, and online otherwise", () => {
    expect(presenceClass(true, true)).toBe("dnd");
    expect(presenceClass(true, false)).toBe("online");
    expect(presenceClass(true, undefined)).toBe("online");
    expect(presenceClass(false, true)).toBe("offline");
    expect(presenceClass(false, false)).toBe("offline");
  });

  it("shows a phone for someone online only on mobile, unless on do not disturb", () => {
    expect(presenceClass(true, false, true)).toBe("mobile");
    expect(presenceClass(true, true, true)).toBe("dnd");
    expect(presenceClass(false, false, true)).toBe("offline");
    expect(presenceLabel(true, false, true)).toBe("online on mobile");
    expect(presenceLabel(true, true, true)).toBe("do not disturb");
    expect(presenceLabel(false, false, true)).toBe("offline");
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
