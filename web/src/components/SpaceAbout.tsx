import { Link } from "@tanstack/react-router";
import { canManageChannels } from "../api/permissions";
import { useMembers } from "../api/queries";
import type { Space } from "../gen/stoop/chat/v1/space_pb";
import { Modal } from "./Modal";
import { SpaceIcon } from "./SpaceIcon";
import { WelcomeText } from "./WelcomeText";

// What the space says about itself, in full: the description the sidebar
// can only show a slice of, and the welcome text a member read once on
// arrival and may want again. Opened from the description line under the
// space name.
export function SpaceAbout({
  space,
  onClose,
}: {
  space: Space;
  onClose: () => void;
}) {
  const { data: members } = useMembers(space.id);
  const count = members?.length;
  return (
    <Modal title="About this space" onClose={onClose}>
      <div className="space-about">
        <header className="space-about-head">
          <span className="space-pill static" aria-hidden="true">
            <SpaceIcon name={space.name} fileId={space.iconFileId} />
          </span>
          <div>
            <strong>{space.name}</strong>
            {count !== undefined && (
              <p className="muted small">
                {count} member{count === 1 ? "" : "s"}
              </p>
            )}
          </div>
        </header>
        {space.description && <p>{space.description}</p>}
        {space.welcome && (
          <>
            <hr className="about-rule" />
            <WelcomeText text={space.welcome} />
          </>
        )}
        {!space.description && !space.welcome && (
          <p className="muted">
            {canManageChannels(space)
              ? "This space hasn't said what it is yet — add a description in settings."
              : "This space hasn't said what it is yet."}
          </p>
        )}
      </div>
      {canManageChannels(space) && (
        <footer className="modal-actions">
          <Link
            to="/s/$spaceId/settings"
            params={{ spaceId: space.id }}
            search={{}}
            className="chip"
            onClick={onClose}
          >
            Space settings
          </Link>
        </footer>
      )}
    </Modal>
  );
}
