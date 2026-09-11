import { describe, expect, it } from "vitest";
import type { Member } from "../../gen/stoop/chat/v1/member_pb";
import { headingText, matches, memberName, splitMembers } from "./groups";

const member = (userId: string, username: string, displayName = ""): Member =>
  ({ userId, username, displayName }) as Member;

describe("memberName", () => {
  it("prefers the display name", () => {
    expect(memberName(member("1", "ada", "Ada W."))).toBe("Ada W.");
  });

  it("falls back to the username when there is no display name", () => {
    expect(memberName(member("1", "ada"))).toBe("ada");
  });
});

describe("matches", () => {
  it("matches either name, case-insensitively", () => {
    const m = member("1", "ada", "Ada W.");
    expect(matches(m, "ad")).toBe(true);
    expect(matches(m, "w.")).toBe(true);
    expect(matches(m, "bea")).toBe(false);
  });

  // The caller lowercases the needle; a caller that forgets gets no match
  // rather than a crash.
  it("takes the needle already lowercased", () => {
    expect(matches(member("1", "ada"), "ADA")).toBe(false);
  });
});

describe("splitMembers", () => {
  const members = [
    member("1", "ada", "Ada W."),
    member("2", "bea"),
    member("3", "casey"),
  ];
  const online = new Set(["1", "3"]);

  it("splits on presence and keeps the server's order", () => {
    const { online: on, offline } = splitMembers(members, online, "");
    expect(on.map((m) => m.username)).toEqual(["ada", "casey"]);
    expect(offline.map((m) => m.username)).toEqual(["bea"]);
  });

  it("narrows both groups to the search", () => {
    const { online: on, offline } = splitMembers(members, online, "ada");
    expect(on.map((m) => m.username)).toEqual(["ada"]);
    expect(offline.map((m) => m.username)).toEqual([]);
  });

  it("matches a substring anywhere in the name, not just the start", () => {
    const { online: on, offline } = splitMembers(members, online, "e");
    expect(on.map((m) => m.username)).toEqual(["casey"]);
    expect(offline.map((m) => m.username)).toEqual(["bea"]);
  });

  it("ignores surrounding whitespace and case in the query", () => {
    expect(splitMembers(members, online, "  ADA ").online).toHaveLength(1);
  });

  it("treats a whitespace-only query as no search", () => {
    expect(splitMembers(members, online, "   ").online).toHaveLength(2);
  });

  it("puts everyone offline when nobody is present", () => {
    const { online: on, offline } = splitMembers(members, new Set(), "");
    expect(on).toEqual([]);
    expect(offline).toHaveLength(3);
  });
});

describe("headingText", () => {
  it("counts who is online at rest", () => {
    expect(headingText(48, 5, 48, false)).toBe("5/48 online");
  });

  it("counts matches while searching", () => {
    expect(headingText(48, 5, 3, true)).toBe("3 of 48 match");
  });

  it("says so when a search matches nothing", () => {
    expect(headingText(48, 5, 0, true)).toBe("0 of 48 match");
  });
});
