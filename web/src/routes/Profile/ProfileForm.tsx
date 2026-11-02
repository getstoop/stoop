import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { authClient, filesClient } from "../../api/clients";
import { Avatar } from "../../components/Avatar";
import { ImagePicker } from "../../components/ImagePicker";
import { SettingRow } from "../../components/SettingRow";
import {
  BIO_MAX,
  DISPLAY_NAME_MAX,
  PRONOUNS_MAX,
  profileEdits,
} from "../../core/profile";
import type { User } from "../../gen/stoop/auth/v1/auth_pb";
import { useFieldErrors } from "../../hooks/useFieldErrors";

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
  const form = useFieldErrors(["displayName", "username", "pronouns", "bio"]);

  // An admin can rename us or clear a field from under us; adopt what
  // the server says for that field.
  useEffect(() => setName(me.displayName), [me.displayName]);
  useEffect(() => setHandle(me.username), [me.username]);
  useEffect(() => setPronouns(me.pronouns), [me.pronouns]);
  useEffect(() => setBio(me.bio), [me.bio]);

  const edits = profileEdits(me, {
    displayName: name,
    username: handle,
    pronouns,
    bio,
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!edits) return;
    setState("busy");
    form.begin();
    try {
      await authClient.updateProfile(edits);
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      setState("saved");
      setTimeout(() => setState("idle"), 1500);
    } catch (err) {
      form.fail(err);
      setState("idle");
    }
  };

  return (
    <form className="card profile-form" ref={form.formRef} onSubmit={submit}>
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
        error={form.errors.displayName}
      >
        <input
          id="display-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={DISPLAY_NAME_MAX}
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
        error={form.errors.username}
      >
        <input
          id="username"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          autoComplete="username"
          disabled={me.usernameFrozen}
          required
        />
      </SettingRow>
      <SettingRow
        id="pronouns"
        title="Pronouns"
        description="Shown next to your name on your profile card, which people open by clicking your name. Leave it blank and nothing shows."
        error={form.errors.pronouns}
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
        error={form.errors.bio}
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
      {form.formError && (
        <p className="error" role="alert">
          {form.formError}
        </p>
      )}
      <div className="setting-actions">
        <button
          type="submit"
          className="primary"
          disabled={state === "busy" || !edits}
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
