import { describe, expect, it } from "vitest";
import { Permission } from "../gen/stoop/access/v1/access_pb";
import {
  BOT_TOKEN_OPTIONS,
  botOptions,
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

describe("every grantable permission has a home", () => {
  const grantable = Object.values(Permission).filter(
    (v): v is Permission =>
      typeof v === "number" &&
      v !== Permission.UNSPECIFIED &&
      v !== Permission.ACCOUNT_SECURITY,
  );
  // Offered to nobody on purpose; a token holding one is still named.
  const deliberatelyOut = new Set([
    Permission.SPACE_TRANSFER,
    Permission.SPACE_DELETE,
  ]);

  it("is offered to people or deliberately left out", () => {
    const offered = new Set(TOKEN_OPTIONS.flatMap((o) => o.permissions));
    for (const p of grantable) {
      expect(offered.has(p) || deliberatelyOut.has(p)).toBe(true);
    }
  });

  it("names a permission no option covers", () => {
    expect(
      describePermissions([Permission.MESSAGES_POST, Permission.SPACE_DELETE]),
    ).toEqual(["Post messages", "space delete"]);
    expect(describePermissions([Permission.SPACE_DELETE])).toEqual([
      "space delete",
    ]);
  });
});

describe("botOptions", () => {
  it("offers the server group only to an instance-admin bot", () => {
    const groups = (admin: boolean) =>
      new Set(botOptions({ instanceAdmin: admin }).map((o) => o.group));
    expect(groups(false)).toEqual(new Set(["space", "account"]));
    expect(groups(true)).toEqual(new Set(["space", "account", "server"]));
  });

  it("never offers a bot what the server refuses it", () => {
    const offered = new Set(BOT_TOKEN_OPTIONS.flatMap((o) => o.permissions));
    for (const p of [
      Permission.PROFILE_MANAGE,
      Permission.PREFERENCES_MANAGE,
      Permission.DMS_READ,
      Permission.DMS_POST,
      Permission.DMS_REACH_ANYONE,
      Permission.SPACES_CREATE,
      Permission.SPACES_JOIN_ANY,
    ]) {
      expect(offered.has(p)).toBe(false);
    }
    expect(offered.has(Permission.ACTIVITY_READ)).toBe(true);
  });

  it("describes a bot's token in the bot's words", () => {
    expect(
      describePermissions([Permission.ACTIVITY_READ], BOT_TOKEN_OPTIONS),
    ).toEqual(["Read its mentions and replies"]);
  });
});
