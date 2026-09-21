import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { chatClient } from "../../api/clients";
import { Field } from "../../components/Field";
import { useFieldErrors } from "../../hooks/useFieldErrors";

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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    form.begin();
    try {
      const res = await chatClient.createSpace({ name });
      if (!res.space || !res.defaultChannel) {
        throw new Error("space was created without a default channel");
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
    <form className="login-card bare" ref={form.formRef} onSubmit={submit}>
      <p>
        <strong>Create your first space.</strong>
      </p>
      <p className="hint">
        A space is where your people hang out — it holds channels for text and
        voice. You can make more later.
      </p>
      <Field label="Space name" error={form.errors.name}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="The Porch"
          maxLength={100}
          required
        />
      </Field>
      <button type="submit" className="primary" disabled={busy}>
        Create space
      </button>
    </form>
  );
}
