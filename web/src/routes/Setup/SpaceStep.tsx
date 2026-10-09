import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { chatClient } from "../../api/clients";
import { useVoiceAvailable } from "../../api/queries";
import { MAX_SPACE_NAME } from "../../api/spaces";
import { Field } from "../../components/Field";
import { ChannelKind } from "../../gen/stoop/chat/v1/channel_pb";
import { useFieldErrors } from "../../hooks/useFieldErrors";
import { WizardActions } from "./WizardActions";

export type CreatedSpace = { id: string; channelId: string; name: string };

// Step 2: the first space. The invite step needs to know where to land.
export function SpaceStep({
  onDone,
}: {
  onDone: (space: CreatedSpace) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const form = useFieldErrors(["name"]);
  const [busy, setBusy] = useState(false);
  const voiceAvailable = useVoiceAvailable();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    form.begin();
    if (!name.trim()) {
      form.set("name", "Name your space.");
      return;
    }
    setBusy(true);
    try {
      const res = await chatClient.createSpace({ name });
      if (!res.space || !res.defaultChannel) {
        throw new Error("space was created without a default channel");
      }
      if (voiceAvailable) {
        // Not worth stopping setup over; it can be added from the sidebar.
        await chatClient
          .createChannel({
            spaceId: res.space.id,
            name: "lounge",
            kind: ChannelKind.VOICE,
          })
          .catch(() => {});
      }
      await queryClient.invalidateQueries({ queryKey: ["spaces"] });
      onDone({
        id: res.space.id,
        channelId: res.defaultChannel.id,
        name: res.space.name,
      });
    } catch (err) {
      form.fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="login-card bare"
      ref={form.formRef}
      onSubmit={submit}
      noValidate
    >
      <p>
        <strong>Create your first space.</strong>
      </p>
      <p className="hint">
        A space holds your channels. You can make more later.
      </p>
      <Field
        label="Space name"
        error={form.errors.name}
        hint={
          voiceAvailable
            ? "It starts with #general and a voice channel, lounge."
            : "It starts with #general."
        }
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_SPACE_NAME}
          required
        />
      </Field>
      <WizardActions label="Create space" busy={busy} />
    </form>
  );
}
