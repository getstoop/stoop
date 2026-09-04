import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { authClient, filesClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { Avatar } from "../../components/Avatar";
import { ImagePicker } from "../../components/ImagePicker";
import { SettingRow } from "../../components/SettingRow";
import type { User } from "../../gen/stoop/auth/v1/auth_pb";

// The server's own caps, mirrored so the fields count down rather than
// let a save fail (internal/auth/profile.go).
const PRONOUNS_MAX = 40;
const BIO_MAX = 300;

// Who other people see: the avatar, the two names, and what you say
// about yourself. One form and one UpdateProfile call; the button wakes
// when any field differs from what the server has.
export function ProfileForm({ me }: { me: User }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(me.displayName);
  const [handle, setHandle] = useState(me.username);
  const [pronouns, setPronouns] = useState(me.pronouns);
  const [bio, setBio] = useState(me.bio);
  const [state, setState] = useState<"idle" | "busy" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  // An admin can rename us or clear a field from under us; adopt what
  // the server says for that field.
  useEffect(() => setName(me.displayName), [me.displayName]);
  useEffect(() => setHandle(me.username), [me.username]);
  useEffect(() => setPronouns(me.pronouns), [me.pronouns]);
  useEffect(() => setBio(me.bio), [me.bio]);

  const nameChanged = name.trim() !== me.displayName;
  const handleChanged = handle.trim() !== me.username;
  const pronounsChanged = pronouns !== me.pronouns;
  const bioChanged = bio !== me.bio;
  const changed = nameChanged || handleChanged || pronounsChanged || bioChanged;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState("busy");
    setError(null);
    try {
      await authClient.updateProfile({
        displayName: name.trim(),
        username: handleChanged ? handle.trim() : undefined,
        pronouns: pronounsChanged ? pronouns : undefined,
        bio: bioChanged ? bio : undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      setState("saved");
      setTimeout(() => setState("idle"), 1500);
    } catch (err) {
      setError(errorText(err));
      setState("idle");
    }
  };

  return (
    <form className="card profile-form" onSubmit={submit}>
      <SettingRow
        title="Avatar"
        description="Beside your messages and on your profile card. PNG, JPEG, GIF or WebP up to 2 MB, cropped to a square."
      >
        <Avatar name={me.displayName} fileId={me.avatarFileId} size="large" />
        <AvatarPicker hasAvatar={me.avatarFileId !== ""} />
      </SettingRow>
      <SettingRow
        id="display-name"
        title="Display name"
        description="How you appear in messages."
      >
        <input
          id="display-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={50}
          required
        />
      </SettingRow>
      <SettingRow
        id="username"
        title="Username"
        description={
          me.usernameFrozen
            ? "How people mention you. Locked by a server admin."
            : me.usernamePending
              ? "How people mention you. This one came from your login provider — make it yours."
              : "How people mention you. 3 to 32 letters, numbers or underscores."
        }
      >
        <input
          id="username"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          pattern="[a-zA-Z0-9_]{3,32}"
          title="3-32 letters, numbers, or _"
          autoComplete="username"
          disabled={me.usernameFrozen}
          required
        />
      </SettingRow>
      <SettingRow
        id="pronouns"
        title="Pronouns"
        description="Shown next to your name on your profile card, which people open by clicking your name. Leave it blank and nothing shows."
      >
        <input
          id="pronouns"
          value={pronouns}
          onChange={(e) => setPronouns(e.target.value)}
          maxLength={PRONOUNS_MAX}
          placeholder="she/her"
        />
        <span className="muted small">
          {pronouns.length} / {PRONOUNS_MAX}
        </span>
      </SettingRow>
      <SettingRow
        id="bio"
        title="Bio"
        description="A line or two people see on that same card. Plain text."
      >
        <textarea
          id="bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={BIO_MAX}
          rows={3}
          placeholder="Runs the tool library. Ask me about the bandsaw."
        />
        <span className="muted small">
          {bio.length} / {BIO_MAX}
        </span>
      </SettingRow>
      {error && <p className="error">{error}</p>}
      <div className="setting-actions">
        <button
          type="submit"
          className="primary"
          disabled={state === "busy" || !changed}
        >
          {state === "saved" ? "Saved" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function AvatarPicker({ hasAvatar }: { hasAvatar: boolean }) {
  const queryClient = useQueryClient();
  const upload = async (bytes: Uint8Array) => {
    await filesClient.uploadAvatar({ data: bytes });
    await queryClient.invalidateQueries({ queryKey: ["me"] });
  };
  return (
    <ImagePicker
      label={hasAvatar ? "Change avatar" : "Upload avatar"}
      onPick={upload}
    />
  );
}
