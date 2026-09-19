import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { filesClient, integrationsClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { useAllSpaces, useBots } from "../../api/queries";
import { IdentityKind } from "../../gen/stoop/access/v1/access_pb";
import type { Bot } from "../../gen/stoop/integrations/v1/bot_pb";
import { Avatar } from "../Avatar";
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
  const [error, setError] = useState<string | null>(null);

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
  const save = async () => {
    if (!ready || !changed) return;
    setBusy(true);
    setError(null);
    try {
      if (nameChanged || handleChanged || bioChanged) {
        await integrationsClient.updateBot({
          id: bot.id,
          displayName: nameChanged ? displayName.trim() : undefined,
          username: handleChanged ? username.trim() : undefined,
          bio: bioChanged ? bio : undefined,
        });
      }
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
      await refresh();
      onClose();
    } catch (err) {
      setError(errorText(err));
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
            type="button"
            className="primary"
            onClick={save}
            disabled={busy || !ready || !changed}
          >
            Save
          </button>
        </>
      }
    >
      <div className="modal-body integration-form">
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
        <label className="field">
          Display name
          <input
            name="bot-display-name"
            value={displayName}
            maxLength={50}
            onChange={(e) => setDisplayName(e.target.value)}
            // biome-ignore lint/a11y/noAutofocus: the first field of the dialog
            autoFocus
          />
        </label>
        <label className="field">
          Username
          <input
            name="bot-username"
            value={username}
            maxLength={32}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="field">
          About this bot
          <textarea
            name="bot-bio"
            value={bio}
            maxLength={BIO_MAX}
            rows={3}
            onChange={(e) => setBio(e.target.value)}
          />
          <span className="hint">
            Shown on its profile card, so people can tell what it does.{" "}
            {bio.length}/{BIO_MAX}
          </span>
        </label>
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
        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  );
}
