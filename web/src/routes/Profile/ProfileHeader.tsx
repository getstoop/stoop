import { Avatar } from "../../components/Avatar";
import { MenuButton } from "../../components/MenuButton";
import type { User } from "../../gen/stoop/auth/v1/auth_pb";

// The account page's identity in the nav: who you are, nothing to do.
// Changing any of it is the Profile section's job.
export function ProfileHeader({ me }: { me: User }) {
  return (
    <header className="profile-header">
      <MenuButton />
      <Avatar name={me.displayName} fileId={me.avatarFileId} size="medium" />
      <div>
        <h2>{me.displayName}</h2>
        <p className="muted">
          @{me.username}
          {me.pronouns && ` · ${me.pronouns}`}
        </p>
      </div>
    </header>
  );
}
