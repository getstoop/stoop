import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useId, useState } from "react";
import { filesClient, integrationsClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { useAllSpaces } from "../../api/queries";
import { useFieldErrors } from "../../hooks/useFieldErrors";
import { notice } from "../../stores/dialogs";
import { Field } from "../Field";
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
  const form = useFieldErrors(["username", "displayName", "bio"]);
  const formId = useId();
  const ready = username.trim() !== "" && displayName.trim() !== "";

  useEffect(() => {
    if (!avatar) return;
    const url = URL.createObjectURL(new Blob([avatar as BlobPart]));
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [avatar]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    form.begin();
    try {
      const res = await integrationsClient.createBot({
        username: username.trim(),
        displayName: displayName.trim(),
        bio,
      });
      const id = res.bot?.id ?? "";
      // The bot exists now, so this form has nothing left to retry: a
      // failure past here closes it and says which step to finish by hand.
      let unfinished: string | null = null;
      try {
        for (const spaceId of spaceIds) {
          await integrationsClient.addBotToSpace({ botUserId: id, spaceId });
        }
      } catch (err) {
        unfinished = `It wasn't added to every space: ${errorText(err)}`;
      }
      try {
        if (avatar && id) {
          await filesClient.uploadBotAvatar({ userId: id, data: avatar });
        }
      } catch (err) {
        unfinished ??= `Its avatar wasn't saved: ${errorText(err)}`;
      }
      await queryClient.invalidateQueries({ queryKey: ["bots"] });
      await queryClient.invalidateQueries({ queryKey: ["members"] });
      onClose();
      if (unfinished) {
        notice({ title: "The bot was created", body: unfinished });
      }
    } catch (err) {
      form.fail(err);
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
            type="submit"
            form={formId}
            className="primary"
            disabled={busy || !ready}
          >
            Create bot
          </button>
        </>
      }
    >
      <form
        id={formId}
        ref={form.formRef}
        className="modal-body integration-form"
        onSubmit={create}
      >
        <div className="bot-edit-avatar">
          <span
            className="avatar medium"
            // off-scale: the picked image, before it is uploaded
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
        <Field label="Username" error={form.errors.username}>
          <input
            name="bot-username"
            value={username}
            maxLength={32}
            placeholder="e.g. homeassistant"
            onChange={(e) => setUsername(e.target.value)}
            // biome-ignore lint/a11y/noAutofocus: the first field of the dialog
            autoFocus
          />
        </Field>
        <Field label="Display name" error={form.errors.displayName}>
          <input
            name="bot-display-name"
            value={displayName}
            maxLength={50}
            placeholder="e.g. Home Assistant"
            onChange={(e) => setDisplayName(e.target.value)}
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
            Its tokens and webhooks work only in the spaces it's in. You can
            change this later.
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
