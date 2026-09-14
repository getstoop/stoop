import { describe, expect, it } from "vitest";
import { Permission } from "../gen/stoop/access/v1/access_pb";
import {
  canCreate,
  describePermissions,
  expiryOf,
  heldOptions,
  lastUsedText,
  permissionsFor,
  TOKEN_OPTIONS,
  whereText,
} from "./tokenOptions";

describe("heldOptions", () => {
  it("offers only options whose every permission is held", () => {
    const keys = heldOptions([
      Permission.SPACE_READ,
      Permission.MESSAGES_READ,
      Permission.MESSAGES_POST,
      Permission.DMS_READ,
    ]).map((o) => o.key);
    expect(keys).toEqual(["read", "post", "dms-read"]);
  });

  it("drops a bundle when only half of it is held", () => {
    expect(heldOptions([Permission.MESSAGES_READ])).toEqual([]);
  });

  it("never offers account security", () => {
    for (const o of TOKEN_OPTIONS) {
      expect(o.permissions).not.toContain(Permission.ACCOUNT_SECURITY);
    }
  });
});

describe("permissionsFor", () => {
  it("expands and deduplicates the chosen options", () => {
    expect(permissionsFor(["read", "post", "read"])).toEqual([
      Permission.SPACE_READ,
      Permission.MESSAGES_READ,
      Permission.MESSAGES_POST,
    ]);
  });
});

describe("canCreate", () => {
  const ok = { name: "script", keys: ["read"] };

  it("needs a name and a permission", () => {
    expect(canCreate(ok)).toBe(true);
    expect(canCreate({ ...ok, name: "  " })).toBe(false);
    expect(canCreate({ ...ok, keys: [] })).toBe(false);
    expect(canCreate({ ...ok, keys: ["dms-read"] })).toBe(true);
  });
});

describe("describePermissions", () => {
  it("names the options a token's permissions cover", () => {
    expect(
      describePermissions([
        Permission.SPACE_READ,
        Permission.MESSAGES_READ,
        Permission.MESSAGES_POST,
      ]),
    ).toEqual(["Read messages", "Post messages"]);
  });
});

describe("whereText", () => {
  const names: Record<string, string> = {
    a: "The Stoop",
    b: "Basement Arcade",
  };
  const nameOf = (id: string) => names[id];

  it("reads everywhere, named spaces, a count, or nowhere", () => {
    expect(whereText({ limited: false, spaceIds: [] }, nameOf)).toBe(
      "Everywhere",
    );
    expect(whereText({ limited: true, spaceIds: ["a", "b"] }, nameOf)).toBe(
      "The Stoop, Basement Arcade",
    );
    expect(whereText({ limited: true, spaceIds: ["a", "zz"] }, nameOf)).toBe(
      "2 spaces",
    );
    expect(whereText({ limited: true, spaceIds: [] }, nameOf)).toMatch(
      /Nowhere/,
    );
  });
});

describe("lastUsedText and expiryOf", () => {
  const now = new Date("2026-09-13T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const hour = 3_600_000;
  const day = 24 * hour;

  it("says when a token was last used", () => {
    expect(lastUsedText(undefined, now)).toBe("Never");
    expect(lastUsedText(ago(10_000), now)).toBe("just now");
    expect(lastUsedText(ago(2 * hour), now)).toBe("2 hours ago");
    expect(lastUsedText(ago(day + hour), now)).toBe("yesterday");
    expect(lastUsedText(ago(5 * day), now)).toBe("5 days ago");
  });

  it("says when a token runs out", () => {
    expect(expiryOf(undefined, now)).toEqual({ text: "Never", state: "never" });
    expect(expiryOf(ago(1), now).state).toBe("expired");
    expect(expiryOf(ago(-6 * day), now)).toEqual({
      text: "In 6 days",
      state: "soon",
    });
    expect(expiryOf(ago(-86 * day), now)).toEqual({
      text: "In 86 days",
      state: "ok",
    });
  });
});
