import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { chatClient } from "../../api/clients";
import { useVoiceAvailable } from "../../api/queries";
import { MAX_SPACE_NAME } from "../../api/spaces";
import { SettingRow } from "../../components/SettingRow";
import { Switch } from "../../components/Switch";
import type { Space } from "../../gen/stoop/chat/v1/space_pb";
import { useFieldErrors } from "../../hooks/useFieldErrors";
import { IconSetting } from "./IconSetting";
import { WelcomeEditor } from "./WelcomeEditor";

// The server's own limit, mirrored so the field can count down rather
// than let a save fail (internal/chat/spaces.go).
const DESCRIPTION_MAX = 200;

// Everything a space is and says about itself, as one form with one Save:
// the name, the line an invite shows a stranger, the greeting a member
// reads on arrival, and the two switches. The icon is the exception
// (IconSetting): it applies as soon as it uploads, like an avatar does.
export function GeneralSection({ space }: { space: Space }) {
  const queryClient = useQueryClient();
  const voiceAvailable = useVoiceAvailable();
  const [name, setName] = useState(space.name);
  const [description, setDescription] = useState(space.description);
  const [welcome, setWelcome] = useState(space.welcome);
  const [membersCanInvite, setMembersCanInvite] = useState(
    space.membersCanInvite,
  );
  const [voiceEnabled, setVoiceEnabled] = useState(space.voiceEnabled);
  const [state, setState] = useState<"idle" | "busy" | "saved">("idle");
  const form = useFieldErrors(["name", "description", "welcome"]);

  // Another admin's edit arrives as SpaceUpdated; adopt what the server
  // says for that field.
  useEffect(() => setName(space.name), [space.name]);
  useEffect(() => setDescription(space.description), [space.description]);
  useEffect(() => setWelcome(space.welcome), [space.welcome]);
  useEffect(
    () => setMembersCanInvite(space.membersCanInvite),
    [space.membersCanInvite],
  );
  useEffect(() => setVoiceEnabled(space.voiceEnabled), [space.voiceEnabled]);

  const nameChanged = name.trim() !== space.name;
  const descriptionChanged = description !== space.description;
  const welcomeChanged = welcome !== space.welcome;
  const inviteChanged = membersCanInvite !== space.membersCanInvite;
  const voiceChanged = voiceEnabled !== space.voiceEnabled;
  const changed =
    nameChanged ||
    descriptionChanged ||
    welcomeChanged ||
    inviteChanged ||
    voiceChanged;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    form.begin();
    if (!name.trim()) {
      form.set("name", "Enter a space name.");
      return;
    }
    setState("busy");
    try {
      await chatClient.updateSpace({
        spaceId: space.id,
        name: nameChanged ? name.trim() : undefined,
        description: descriptionChanged ? description : undefined,
        welcome: welcomeChanged ? welcome : undefined,
        membersCanInvite: inviteChanged ? membersCanInvite : undefined,
        voiceEnabled: voiceChanged ? voiceEnabled : undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ["spaces"] });
      // The voice switch decides which channels the space lists.
      if (voiceChanged) {
        await queryClient.invalidateQueries({
          queryKey: ["channels", space.id],
        });
      }
      setState("saved");
      setTimeout(() => setState("idle"), 1500);
    } catch (err) {
      form.fail(err);
      setState("idle");
    }
  };

  return (
    <form className="card general-section" ref={form.formRef} onSubmit={submit}>
      <IconSetting space={space} />
      <SettingRow id="space-name" title="Space name" error={form.errors.name}>
        <input
          id="space-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_SPACE_NAME}
          required
        />
      </SettingRow>
      <SettingRow
        id="space-description"
        title="Description"
        description="One line, shown under the space name and to anyone holding an invite link. Plain text."
        error={form.errors.description}
      >
        <textarea
          id="space-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={DESCRIPTION_MAX}
          rows={2}
          placeholder="Neighbours between 4th and 7th."
        />
        <span className="muted small">
          {description.length} / {DESCRIPTION_MAX}
        </span>
      </SettingRow>
      <SettingRow
        title="Welcome"
        description="Members see this when they first arrive, and any time after from About this space. Formatted the way a message is, but no headings."
        error={form.errors.welcome}
      >
        <WelcomeEditor value={welcome} onChange={setWelcome} />
      </SettingRow>
      <SettingRow
        id="members-can-invite"
        className="ruled"
        title="Members can create invites"
        description="Otherwise only admins and the owner can. Members' invites always grant the member role."
      >
        <Switch
          id="members-can-invite"
          checked={membersCanInvite}
          onChange={(e) => setMembersCanInvite(e.target.checked)}
        />
      </SettingRow>
      {voiceAvailable && (
        <SettingRow
          id="voice-enabled"
          className="ruled"
          title="Voice channels"
          description="Off hides them and ends any call; nothing is deleted."
        >
          <Switch
            id="voice-enabled"
            checked={voiceEnabled}
            onChange={(e) => setVoiceEnabled(e.target.checked)}
          />
        </SettingRow>
      )}
      {form.formError && (
        <p className="error" role="alert">
          {form.formError}
        </p>
      )}
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
