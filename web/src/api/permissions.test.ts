import { describe, expect, it } from "vitest";
import { Permission } from "../gen/stoop/access/v1/access_pb";
import {
  type Channel,
  ChannelPostPolicy,
} from "../gen/stoop/chat/v1/channel_pb";
import { type Space, SpaceRole } from "../gen/stoop/chat/v1/space_pb";
import {
  atLeast,
  can,
  canActOn,
  canCreateInvites,
  canDeleteAnyMessage,
  canDeleteSpace,
  canManageChannels,
  canManageMembers,
  canMentionEveryone,
  canPost,
  grantableRoles,
  roleLabel,
} from "./permissions";

const space = (myRole: SpaceRole, myPermissions: Permission[] = []): Space =>
  ({ myRole, myPermissions }) as unknown as Space;

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

describe("can", () => {
  it("reads the server's list and nothing else", () => {
    const owner = space(SpaceRole.OWNER, [Permission.MESSAGES_READ]);
    expect(can(owner, Permission.MESSAGES_READ)).toBe(true);
    // An owner's role says nothing here: a narrow credential lists less.
    expect(can(owner, Permission.CHANNELS_MANAGE)).toBe(false);
  });

  it("allows nothing without a space", () => {
    expect(can(undefined, Permission.MESSAGES_READ)).toBe(false);
  });

  it("allows nothing with an empty list", () => {
    expect(can(space(SpaceRole.OWNER), Permission.SPACE_DELETE)).toBe(false);
  });
});

describe("named checks", () => {
  const checks: [string, (s: Space) => boolean, Permission][] = [
    ["canCreateInvites", canCreateInvites, Permission.INVITES_CREATE],
    ["canManageChannels", canManageChannels, Permission.CHANNELS_MANAGE],
    ["canManageMembers", canManageMembers, Permission.MEMBERS_MANAGE],
    [
      "canMentionEveryone",
      canMentionEveryone,
      Permission.MESSAGES_NOTIFY_EVERYONE,
    ],
    ["canDeleteAnyMessage", canDeleteAnyMessage, Permission.MESSAGES_MODERATE],
    ["canDeleteSpace", canDeleteSpace, Permission.SPACE_DELETE],
  ];

  for (const [name, check, permission] of checks) {
    it(`${name} follows its one permission, not the role`, () => {
      expect(check(space(SpaceRole.MEMBER, [permission]))).toBe(true);
      expect(check(space(SpaceRole.OWNER, []))).toBe(false);
    });
  }
});

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

  it("admits only the owner when the minimum is owner", () => {
    const ok = roles.filter((r) => atLeast(r, SpaceRole.OWNER));
    expect(ok.map((r) => names[r])).toEqual(["owner"]);
  });

  it("does not let a role reach the rung above it", () => {
    expect(atLeast(SpaceRole.MEMBER, SpaceRole.ADMIN)).toBe(false);
    expect(atLeast(SpaceRole.ADMIN, SpaceRole.OWNER)).toBe(false);
    expect(atLeast(SpaceRole.UNSPECIFIED, SpaceRole.MEMBER)).toBe(false);
  });
});

describe("grantableRoles", () => {
  it("gives an owner member and admin, never owner", () => {
    expect(grantableRoles(space(SpaceRole.OWNER))).toEqual([
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
});

describe("roleLabel", () => {
  it("names each role", () => {
    expect(roleLabel(SpaceRole.OWNER)).toBe("owner");
    expect(roleLabel(SpaceRole.ADMIN)).toBe("admin");
    expect(roleLabel(SpaceRole.MEMBER)).toBe("member");
  });

  // Anything unrecognised reads as "member" rather than blank, which is
  // what an unset role in a badge should say.
  it("falls back to member for an unspecified role", () => {
    expect(roleLabel(SpaceRole.UNSPECIFIED)).toBe("member");
  });
});

describe("canActOn", () => {
  const manage = [Permission.MEMBERS_MANAGE];
  const casey = space(SpaceRole.OWNER, manage);
  const ada = space(SpaceRole.ADMIN, manage);
  const bea = space(SpaceRole.MEMBER);

  it("refuses anyone who cannot manage members", () => {
    expect(canActOn(bea, false, SpaceRole.MEMBER)).toBe(false);
    // The role alone doesn't do it: an owner on a narrow credential.
    expect(canActOn(space(SpaceRole.OWNER), false, SpaceRole.MEMBER)).toBe(
      false,
    );
  });

  // The manage-members gate runs first, so the instance-admin flag alone
  // does not rescue a caller who can't manage members.
  it("refuses a plain member even when the instance-admin flag is set", () => {
    expect(canActOn(bea, true, SpaceRole.MEMBER)).toBe(false);
  });

  it("never allows acting on the owner", () => {
    expect(canActOn(casey, false, SpaceRole.OWNER)).toBe(false);
    expect(canActOn(ada, true, SpaceRole.OWNER)).toBe(false);
  });

  it("lets the owner act on every other role", () => {
    expect(canActOn(casey, false, SpaceRole.ADMIN)).toBe(true);
    expect(canActOn(casey, false, SpaceRole.MEMBER)).toBe(true);
  });

  it("lets an admin act only on roles strictly below their own", () => {
    expect(canActOn(ada, false, SpaceRole.MEMBER)).toBe(true);
    expect(canActOn(ada, false, SpaceRole.ADMIN)).toBe(false);
  });

  it("lets an instance admin act on a fellow admin", () => {
    expect(canActOn(ada, true, SpaceRole.ADMIN)).toBe(true);
  });
});

describe("canPost", () => {
  const channel = (postPolicy: ChannelPostPolicy): Channel =>
    ({ postPolicy }) as unknown as Channel;
  const member = space(SpaceRole.MEMBER, [Permission.MESSAGES_POST]);
  const admin = space(SpaceRole.ADMIN, [
    Permission.MESSAGES_POST,
    Permission.CHANNELS_MANAGE,
  ]);

  it("lets anyone post where everyone posts", () => {
    expect(canPost(member, channel(ChannelPostPolicy.EVERYONE))).toBe(true);
  });

  it("takes manage_channels in an announcement channel", () => {
    expect(canPost(member, channel(ChannelPostPolicy.ADMINS))).toBe(false);
    expect(canPost(admin, channel(ChannelPostPolicy.ADMINS))).toBe(true);
  });

  it("leaves a direct message and a loading channel alone", () => {
    expect(canPost(undefined, channel(ChannelPostPolicy.EVERYONE))).toBe(true);
    expect(canPost(member, undefined)).toBe(true);
  });
});
