import { Navigate } from "@tanstack/react-router";
import { useInstanceStatus, useMe, useSpaces } from "../api/queries";
import { InstanceRole } from "../gen/stoop/auth/v1/auth_pb";
import { SpaceCreationPolicy } from "../gen/stoop/instance/v1/instance_pb";

// Landing view: bounce to the first space, or invite the user to make one.
export function HomePage() {
  const { data: spaces, isLoading } = useSpaces();
  const { data: me } = useMe();
  const { data: status } = useInstanceStatus();
  const canCreateSpace =
    me?.role === InstanceRole.ADMIN ||
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
