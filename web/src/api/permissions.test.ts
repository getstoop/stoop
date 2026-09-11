import { describe, expect, it } from "vitest";
import { type Space, SpaceRole } from "../gen/stoop/chat/v1/space_pb";
import {
  atLeast,
  canActOn,
  canCreateInvites,
  canDeleteAnyMessage,
  canManageChannels,
  canManageMembers,
  canMentionEveryone,
  grantableRoles,
  roleLabel,
} from "./permissions";

const space = (myRole: SpaceRole, membersCanInvite = false): Space =>
  ({ myRole, membersCanInvite }) as Space;

const roles = [
  SpaceRole.UNSPECIFIED,
  SpaceRole.MEMBER,
  SpaceRole.ADMIN,
  SpaceRole.OWNER,
];

// roleLabel is itself under test and calls a non-member a "member", so the
// tables below name the roles independently of it.
const names: Record<SpaceRole, string> = {
  [SpaceRole.UNSPECIFIED]: "unspecified",
  [SpaceRole.MEMBER]: "member",
  [SpaceRole.ADMIN]: "admin",
  [SpaceRole.OWNER]: "owner",
};

const allowed = (fn: (s: Space) => boolean, membersCanInvite = false) =>
  roles.filter((r) => fn(space(r, membersCanInvite))).map((r) => names[r]);

describe("atLeast", () => {
  it("admits every role when the minimum is unspecified", () => {
    expect(roles.filter((r) => atLeast(r, SpaceRole.UNSPECIFIED))).toEqual(
      roles,
    );
  });

  it("admits member and up when the minimum is member", () => {
    const ok = roles.filter((r) => atLeast(r, SpaceRole.MEMBER));
    expect(ok.map((r) => names[r])).toEqual(["member", "admin", "owner"]);
  });

  it("admits admin and up when the minimum is admin", () => {
    const ok = roles.filter((r) => atLeast(r, SpaceRole.ADMIN));
    expect(ok.map((r) => names[r])).toEqual(["admin", "owner"]);
  });

  it("admits only the owner when the minimum is owner", () => {
    const ok = roles.filter((r) => atLeast(r, SpaceRole.OWNER));
    expect(ok.map((r) => names[r])).toEqual(["owner"]);
  });

  it("is inclusive at the boundary", () => {
    for (const r of roles) expect(atLeast(r, r)).toBe(true);
  });

  it("does not let a role reach the rung above it", () => {
    expect(atLeast(SpaceRole.MEMBER, SpaceRole.ADMIN)).toBe(false);
    expect(atLeast(SpaceRole.ADMIN, SpaceRole.OWNER)).toBe(false);
    expect(atLeast(SpaceRole.UNSPECIFIED, SpaceRole.MEMBER)).toBe(false);
  });
});

describe("canCreateInvites", () => {
  it("is open to admins and owners while the space setting is off", () => {
    expect(allowed(canCreateInvites)).toEqual(["admin", "owner"]);
  });

  it("opens up to everyone once members may invite", () => {
    expect(allowed(canCreateInvites, true)).toEqual([
      "unspecified",
      "member",
      "admin",
      "owner",
    ]);
  });

  // members_can_invite is read straight through, so a caller with no role
  // in the space passes too.
  it("lets even a caller with no role in through the setting", () => {
    expect(canCreateInvites(space(SpaceRole.UNSPECIFIED, true))).toBe(true);
  });
});

describe("canManageChannels", () => {
  it("is open to admins and owners only", () => {
    expect(allowed(canManageChannels)).toEqual(["admin", "owner"]);
  });

  it("ignores the members-can-invite setting", () => {
    expect(allowed(canManageChannels, true)).toEqual(["admin", "owner"]);
  });
});

describe("canManageMembers", () => {
  it("is open to admins and owners only", () => {
    expect(allowed(canManageMembers)).toEqual(["admin", "owner"]);
  });
});

describe("canMentionEveryone", () => {
  it("is open to admins and owners only", () => {
    expect(allowed(canMentionEveryone)).toEqual(["admin", "owner"]);
  });
});

describe("canDeleteAnyMessage", () => {
  it("is open to admins and owners only", () => {
    expect(allowed(canDeleteAnyMessage)).toEqual(["admin", "owner"]);
  });
});

describe("grantableRoles", () => {
  it("gives an owner member and admin, never owner", () => {
    expect(grantableRoles(space(SpaceRole.OWNER))).toEqual([
      SpaceRole.MEMBER,
      SpaceRole.ADMIN,
    ]);
  });

  it("gives an admin member and admin", () => {
    expect(grantableRoles(space(SpaceRole.ADMIN))).toEqual([
      SpaceRole.MEMBER,
      SpaceRole.ADMIN,
    ]);
  });

  it("caps a member at member", () => {
    expect(grantableRoles(space(SpaceRole.MEMBER))).toEqual([SpaceRole.MEMBER]);
  });

  it("gives a caller with no role nothing", () => {
    expect(grantableRoles(space(SpaceRole.UNSPECIFIED))).toEqual([]);
  });

  it("never offers owner to anyone", () => {
    for (const r of roles) {
      expect(grantableRoles(space(r))).not.toContain(SpaceRole.OWNER);
    }
  });

  it("orders the roles low to high", () => {
    expect(grantableRoles(space(SpaceRole.OWNER))[0]).toBe(SpaceRole.MEMBER);
  });
});

describe("roleLabel", () => {
  it("names owner and admin", () => {
    expect(roleLabel(SpaceRole.OWNER)).toBe("owner");
    expect(roleLabel(SpaceRole.ADMIN)).toBe("admin");
  });

  it("names member", () => {
    expect(roleLabel(SpaceRole.MEMBER)).toBe("member");
  });

  // Anything unrecognised reads as "member" rather than blank, which is
  // what an unset role in a badge should say.
  it("falls back to member for an unspecified role", () => {
    expect(roleLabel(SpaceRole.UNSPECIFIED)).toBe("member");
  });
});

describe("canActOn", () => {
  const casey = space(SpaceRole.OWNER);
  const ada = space(SpaceRole.ADMIN);
  const bea = space(SpaceRole.MEMBER);
  const cal = space(SpaceRole.UNSPECIFIED);

  it("refuses anyone who cannot manage members", () => {
    expect(canActOn(bea, false, SpaceRole.MEMBER)).toBe(false);
    expect(canActOn(cal, false, SpaceRole.MEMBER)).toBe(false);
  });

  // The manage-members gate runs first, so the instance-admin flag alone
  // does not rescue a caller whose effective space role is only member.
  it("refuses a plain member even when the instance-admin flag is set", () => {
    expect(canActOn(bea, true, SpaceRole.MEMBER)).toBe(false);
  });

  it("never allows acting on the owner", () => {
    expect(canActOn(casey, false, SpaceRole.OWNER)).toBe(false);
    expect(canActOn(ada, false, SpaceRole.OWNER)).toBe(false);
    expect(canActOn(ada, true, SpaceRole.OWNER)).toBe(false);
  });

  it("lets the owner act on every other role", () => {
    expect(canActOn(casey, false, SpaceRole.ADMIN)).toBe(true);
    expect(canActOn(casey, false, SpaceRole.MEMBER)).toBe(true);
    expect(canActOn(casey, false, SpaceRole.UNSPECIFIED)).toBe(true);
  });

  it("lets an admin act on roles strictly below their own", () => {
    expect(canActOn(ada, false, SpaceRole.MEMBER)).toBe(true);
    expect(canActOn(ada, false, SpaceRole.UNSPECIFIED)).toBe(true);
  });

  it("stops an admin acting on an equal role", () => {
    expect(canActOn(ada, false, SpaceRole.ADMIN)).toBe(false);
  });

  it("lets an instance admin act on a fellow admin", () => {
    expect(canActOn(ada, true, SpaceRole.ADMIN)).toBe(true);
  });

  // canActOn is told a role, not an identity. The owner's own row is
  // covered by the never-the-owner branch; an instance admin's own row is
  // not, so MembersSection guards it with `!self`.
  it("blocks the owner from their own row but not an instance admin", () => {
    expect(canActOn(casey, false, casey.myRole)).toBe(false);
    expect(canActOn(ada, true, ada.myRole)).toBe(true);
  });
});
