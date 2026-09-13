import { Permission } from "../gen/stoop/access/v1/access_pb";
import { type Space, SpaceRole } from "../gen/stoop/chat/v1/space_pb";

// What the caller may do is the server's answer, not a table kept here:
// Space.my_permissions, and GetMe's permissions for the instance, both
// already narrowed to the credential in use. These read it only to hide
// controls; the server enforces. Roles remain for display, for the roles an
// invite may grant, and for who may act on whom.

export function can(space: Space | undefined, permission: Permission): boolean {
  return !!space && space.myPermissions.includes(permission);
}

export const canCreateInvites = (space: Space) =>
  can(space, Permission.INVITES_CREATE);

export const canManageChannels = (space: Space) =>
  can(space, Permission.CHANNELS_MANAGE);

export const canManageMembers = (space: Space) =>
  can(space, Permission.MEMBERS_MANAGE);

export const canMentionEveryone = (space: Space) =>
  can(space, Permission.MESSAGES_NOTIFY_EVERYONE);

// Deleting someone else's message; your own is always yours to delete.
export const canDeleteAnyMessage = (space: Space) =>
  can(space, Permission.MESSAGES_MODERATE);

export const canDeleteSpace = (space: Space) =>
  can(space, Permission.SPACE_DELETE);

const rank: Record<SpaceRole, number> = {
  [SpaceRole.UNSPECIFIED]: 0,
  [SpaceRole.MEMBER]: 1,
  [SpaceRole.ADMIN]: 2,
  [SpaceRole.OWNER]: 3,
};

export function atLeast(role: SpaceRole, min: SpaceRole): boolean {
  return rank[role] >= rank[min];
}

// Roles an invite from this caller may grant: never above their own, and
// never owner.
export function grantableRoles(space: Space): SpaceRole[] {
  const roles = [SpaceRole.MEMBER, SpaceRole.ADMIN];
  return roles.filter((r) => atLeast(space.myRole, r));
}

export function roleLabel(role: SpaceRole): string {
  switch (role) {
    case SpaceRole.OWNER:
      return "owner";
    case SpaceRole.ADMIN:
      return "admin";
    default:
      return "member";
  }
}

// Mirror of the server's hierarchy rule: never the owner; the owner and
// instance admins may act on anyone else; others only on lower roles.
export function canActOn(
  space: Space,
  viewerIsInstanceAdmin: boolean,
  targetRole: SpaceRole,
): boolean {
  if (!canManageMembers(space)) return false;
  if (targetRole === SpaceRole.OWNER) return false;
  if (space.myRole === SpaceRole.OWNER || viewerIsInstanceAdmin) return true;
  return rank[space.myRole] > rank[targetRole];
}
