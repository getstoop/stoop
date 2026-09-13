import { Navigate } from "@tanstack/react-router";
import { useInstanceStatus, useMyPermissions, useSpaces } from "../api/queries";
import { Permission } from "../gen/stoop/access/v1/access_pb";
import { SpaceCreationPolicy } from "../gen/stoop/instance/v1/instance_pb";

// Landing view: bounce to the first space, or invite the user to make one.
export function HomePage() {
  const { data: spaces, isLoading } = useSpaces();
  const { data: permissions } = useMyPermissions();
  const { data: status } = useInstanceStatus();
  const canCreateSpace =
    !!permissions?.includes(Permission.SPACES_CREATE) ||
    status?.spaceCreation === SpaceCreationPolicy.EVERYONE;

  if (isLoading) {
    return <div className="centered muted">Loading…</div>;
  }
  if (spaces && spaces.length > 0) {
    return <Navigate to="/s/$spaceId" params={{ spaceId: spaces[0].id }} />;
  }
  return (
    <div className="centered">
      <div className="empty-state">
        <h2>Welcome to Stoop</h2>
        <p className="muted">
          {canCreateSpace
            ? "Create a space with the + button, or join one with an invite code."
            : "Join a space with an invite code (the → button)."}
        </p>
      </div>
    </div>
  );
}
