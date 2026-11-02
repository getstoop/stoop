import type { User } from "../gen/stoop/auth/v1/auth_pb";

// What a person may say about themselves: the server's own caps, mirrored
// so the fields count down rather than let a save fail
// (internal/auth/profile.go).
export const DISPLAY_NAME_MAX = 50;
export const PRONOUNS_MAX = 40;
export const BIO_MAX = 300;

export type ProfileDraft = {
  displayName: string;
  username: string;
  pronouns: string;
  bio: string;
};

export type ProfileEdits = {
  displayName: string;
  username?: string;
  pronouns?: string;
  bio?: string;
};

// The UpdateProfile request for a form's fields, or null when they all say
// what the server has. The display name always goes, as the request
// requires it; the rest go only when changed. The stored display name is
// trimmed too: a login provider's may carry stray spaces, which aren't an edit.
export function profileEdits(
  me: Pick<User, "displayName" | "username" | "pronouns" | "bio">,
  draft: ProfileDraft,
): ProfileEdits | null {
  const displayName = draft.displayName.trim();
  const username = draft.username.trim();
  const usernameChanged = username !== me.username;
  const pronounsChanged = draft.pronouns !== me.pronouns;
  const bioChanged = draft.bio !== me.bio;
  if (
    displayName === me.displayName.trim() &&
    !usernameChanged &&
    !pronounsChanged &&
    !bioChanged
  ) {
    return null;
  }
  return {
    displayName,
    username: usernameChanged ? username : undefined,
    pronouns: pronounsChanged ? draft.pronouns : undefined,
    bio: bioChanged ? draft.bio : undefined,
  };
}
