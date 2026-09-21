import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { filesClient, integrationsClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { useAllSpaces, useBots } from "../../api/queries";
import { IdentityKind } from "../../gen/stoop/access/v1/access_pb";
import type { Bot } from "../../gen/stoop/integrations/v1/bot_pb";
import { useFieldErrors } from "../../hooks/useFieldErrors";
import { Avatar } from "../Avatar";
import { Field } from "../Field";
import { ImagePicker } from "../ImagePicker";
import { Modal } from "../Modal";
import { SpacePicker } from "../SpacePicker";

const BIO_MAX = 300;

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

// A bot's face, words and spaces, set by the instance admin who runs it:
// the avatar, both names, a line about what it does for its profile
// card, and the spaces it is a member of, which is where every token and
// webhook it holds works.
export function EditBotModal({
  bot,
  onClose,
}: {
  bot: Bot;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: spaces } = useAllSpaces(true);
  // The avatar shows the latest upload while the dialog stays open.
  const { data: bots } = useBots(true);
  const avatarFileId =
    bots?.find((b) => b.id === bot.id)?.avatarFileId ?? bot.avatarFileId;
  const [displayName, setDisplayName] = useState(bot.displayName);
  const [username, setUsername] = useState(bot.username);
  const [bio, setBio] = useState(bot.bio);
  const [spaceIds, setSpaceIds] = useState<string[]>(bot.spaceIds);
  const [busy, setBusy] = useState(false);
  const form = useFieldErrors(["displayName", "username", "bio"]);
  const formId = useId();

  const nameChanged = displayName.trim() !== bot.displayName;
  const handleChanged = username.trim() !== bot.username;
  const bioChanged = bio !== bot.bio;
  const spacesChanged = !sameSet(spaceIds, bot.spaceIds);
  const changed = nameChanged || handleChanged || bioChanged || spacesChanged;
  const ready = displayName.trim() !== "" && username.trim() !== "";

  // Everyone who renders the bot learns to refetch it.
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["bots"] });
    await queryClient.invalidateQueries({ queryKey: ["members"] });
    await queryClient.invalidateQueries({ queryKey: ["user-profile", bot.id] });
  };
  const uploadAvatar = async (bytes: Uint8Array) => {
    await filesClient.uploadBotAvatar({ userId: bot.id, data: bytes });
    await refresh();
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || !changed) return;
    setBusy(true);
    form.begin();
    try {
      if (nameChanged || handleChanged || bioChanged) {
        await integrationsClient.updateBot({
          id: bot.id,
          displayName: nameChanged ? displayName.trim() : undefined,
          username: handleChanged ? username.trim() : undefined,
          bio: bioChanged ? bio : undefined,
        });
      }
      // The details are saved by now, so a failure past here says which
      // step it was rather than reading as the whole save refused.
      try {
        for (const spaceId of spaceIds) {
          if (!bot.spaceIds.includes(spaceId)) {
            await integrationsClient.addBotToSpace({
              botUserId: bot.id,
              spaceId,
            });
          }
        }
        for (const spaceId of bot.spaceIds) {
          if (!spaceIds.includes(spaceId)) {
            await integrationsClient.removeBotFromSpace({
              botUserId: bot.id,
              spaceId,
            });
          }
        }
      } catch (err) {
        await refresh();
        throw new Error(`Changing its spaces failed: ${errorText(err)}`);
      }
      await refresh();
      onClose();
    } catch (err) {
      form.fail(err);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Edit ${bot.displayName || bot.username}`}
      onClose={onClose}
      small
      footer={
        <>
          <button type="button" className="chip" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            className="primary"
            disabled={busy || !ready || !changed}
          >
            Save
          </button>
        </>
      }
    >
      <form
        id={formId}
        ref={form.formRef}
        className="modal-body integration-form"
        onSubmit={save}
      >
        <div className="bot-edit-avatar">
          <Avatar
            name={bot.displayName || bot.username}
            fileId={avatarFileId}
            kind={IdentityKind.BOT}
            size="medium"
          />
          <ImagePicker
            label={avatarFileId ? "Change avatar" : "Upload avatar"}
            onPick={uploadAvatar}
          />
        </div>
        <Field label="Display name" error={form.errors.displayName}>
          <input
            name="bot-display-name"
            value={displayName}
            maxLength={50}
            onChange={(e) => setDisplayName(e.target.value)}
            // biome-ignore lint/a11y/noAutofocus: the first field of the dialog
            autoFocus
          />
        </Field>
        <Field label="Username" error={form.errors.username}>
          <input
            name="bot-username"
            value={username}
            maxLength={32}
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>
        <Field
          label="About this bot"
          counter={`${bio.length} / ${BIO_MAX}`}
          hint={
            <>Shown on its profile card, so people can tell what it does.</>
          }
          error={form.errors.bio}
        >
          <textarea
            name="bot-bio"
            value={bio}
            maxLength={BIO_MAX}
            rows={3}
            onChange={(e) => setBio(e.target.value)}
          />
        </Field>
        <fieldset className="token-scope">
          <legend className="eyebrow">In these spaces</legend>
          <SpacePicker
            spaces={spaces ?? []}
            selected={spaceIds}
            onChange={setSpaceIds}
          />
          <span className="hint">
            Its tokens and webhooks work only in the spaces it's in. Taking it
            out of a space removes it as a kick would.
          </span>
        </fieldset>
        {form.formError && (
          <p className="error" role="alert">
            {form.formError}
          </p>
        )}
      </form>
    </Modal>
  );
}
