import { type Space, SpaceRole } from "../gen/stoop/chat/v1/space_pb";

// Client-side mirror of the server's fixed permission table, driven by
// Space.my_role (already the caller's *effective* role, so instance admins
// see ADMIN or better). Used only to hide controls; the server enforces.

const rank: Record<SpaceRole, number> = {
  [SpaceRole.UNSPECIFIED]: 0,
  [SpaceRole.MEMBER]: 1,
  [SpaceRole.ADMIN]: 2,
  [SpaceRole.OWNER]: 3,
};

export function atLeast(role: SpaceRole, min: SpaceRole): boolean {
  return rank[role] >= rank[min];
}

export function canCreateInvites(space: Space): boolean {
  return atLeast(space.myRole, SpaceRole.ADMIN) || space.membersCanInvite;
}

export function canManageChannels(space: Space): boolean {
  return atLeast(space.myRole, SpaceRole.ADMIN);
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

export function canMentionEveryone(space: Space): boolean {
  return atLeast(space.myRole, SpaceRole.ADMIN);
}

// Deleting someone else's message needs manage_channels; your own is
// always yours to delete.
export function canDeleteAnyMessage(space: Space): boolean {
  return atLeast(space.myRole, SpaceRole.ADMIN);
}

export function canManageMembers(space: Space): boolean {
  return atLeast(space.myRole, SpaceRole.ADMIN);
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
