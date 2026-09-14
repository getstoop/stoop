import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { filesClient, integrationsClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { useAllSpaces } from "../../api/queries";
import { BotIcon } from "../Icons";
import { ImagePicker } from "../ImagePicker";
import { Modal } from "../Modal";
import { SpacePicker } from "../SpacePicker";

const BIO_MAX = 300;

// A bot account on its own: a member of the spaces picked here, with no
// password, authenticated only through the tokens and hooks it's given
// later. Its face and a line about what it does are set here too, so the
// card can say what it is from its first post.
export function NewBotModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: spaces } = useAllSpaces(true);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [spaceIds, setSpaceIds] = useState<string[]>([]);
  // The picked image waits for the bot to exist, then is uploaded to it.
  const [avatar, setAvatar] = useState<Uint8Array | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = username.trim() !== "" && displayName.trim() !== "";

  useEffect(() => {
    if (!avatar) return;
    const url = URL.createObjectURL(new Blob([avatar as BlobPart]));
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [avatar]);

  const create = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await integrationsClient.createBot({
        username: username.trim(),
        displayName: displayName.trim(),
        bio,
      });
      const id = res.bot?.id ?? "";
      for (const spaceId of spaceIds) {
        await integrationsClient.addBotToSpace({ botUserId: id, spaceId });
      }
      if (avatar && id) {
        await filesClient.uploadBotAvatar({ userId: id, data: avatar });
      }
      await queryClient.invalidateQueries({ queryKey: ["bots"] });
      await queryClient.invalidateQueries({ queryKey: ["members"] });
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New bot"
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
            onClick={create}
            disabled={busy || !ready}
          >
            Create bot
          </button>
        </>
      }
    >
      <div className="modal-body integration-form">
        <div className="bot-edit-avatar">
          <span
            className="avatar medium"
            style={
              preview
                ? {
                    backgroundImage: `url(${preview})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }
                : undefined
            }
          >
            {preview ? null : <BotIcon />}
          </span>
          <ImagePicker
            label={avatar ? "Change avatar" : "Choose avatar"}
            busyLabel="Reading…"
            onPick={async (bytes) => setAvatar(bytes)}
          />
        </div>
        <label className="field">
          Username
          <input
            name="bot-username"
            value={username}
            maxLength={32}
            placeholder="e.g. homeassistant"
            onChange={(e) => setUsername(e.target.value)}
            // biome-ignore lint/a11y/noAutofocus: the first field of the dialog
            autoFocus
          />
        </label>
        <label className="field">
          Display name
          <input
            name="bot-display-name"
            value={displayName}
            maxLength={50}
            placeholder="e.g. Home Assistant"
            onChange={(e) => setDisplayName(e.target.value)}
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
          <legend>In these spaces</legend>
          <SpacePicker
            spaces={spaces ?? []}
            selected={spaceIds}
            onChange={setSpaceIds}
          />
          <span className="hint">
            Its tokens and webhooks work only in the spaces it's in. You can
            change this later.
          </span>
        </fieldset>
        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  );
}
