import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { filesClient, integrationsClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { useBots } from "../../api/queries";
import type { Bot } from "../../gen/stoop/integrations/v1/bot_pb";
import { Avatar } from "../Avatar";
import { ImagePicker } from "../ImagePicker";
import { Modal } from "../Modal";

const BIO_MAX = 300;

// A bot's face and words, set by the instance admin who runs it: the
// avatar, both names, and a line about what it does, which shows on its
// profile card so people can tell what is posting.
export function EditBotModal({
  bot,
  onClose,
}: {
  bot: Bot;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  // The avatar shows the latest upload while the dialog stays open.
  const { data: bots } = useBots(true);
  const avatarFileId =
    bots?.find((b) => b.id === bot.id)?.avatarFileId ?? bot.avatarFileId;
  const [displayName, setDisplayName] = useState(bot.displayName);
  const [username, setUsername] = useState(bot.username);
  const [bio, setBio] = useState(bot.bio);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameChanged = displayName.trim() !== bot.displayName;
  const handleChanged = username.trim() !== bot.username;
  const bioChanged = bio !== bot.bio;
  const changed = nameChanged || handleChanged || bioChanged;
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
      await integrationsClient.updateBot({
        id: bot.id,
        displayName: nameChanged ? displayName.trim() : undefined,
        username: handleChanged ? username.trim() : undefined,
        bio: bioChanged ? bio : undefined,
      });
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
            placeholder="Posts when a service goes down or comes back."
            onChange={(e) => setBio(e.target.value)}
          />
          <span className="hint">
            Shown on its profile card, so people can tell what it does.{" "}
            {bio.length}/{BIO_MAX}
          </span>
        </label>
        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  );
}
