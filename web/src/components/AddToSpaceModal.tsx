import { type FormEvent, useId, useState } from "react";
import { chatClient } from "../api/clients";
import { useSpaces } from "../api/queries";
import { useFieldErrors } from "../hooks/useFieldErrors";
import { Field } from "./Field";
import { Modal } from "./Modal";

// Admin page → Accounts → "Add to space": drop an existing account into
// one of the spaces you're in, no invite needed. Lists the caller's own
// spaces (that's what ListSpaces knows about).
export function AddToSpaceModal({
  user,
  onClose,
  onAdded,
}: {
  user: { id: string; username: string; displayName: string };
  onClose: () => void;
  onAdded: (spaceName: string) => void;
}) {
  const { data: spaces } = useSpaces();
  const [spaceId, setSpaceId] = useState("");
  const [busy, setBusy] = useState(false);
  // One field, so every refusal is about it: "already a member" is about
  // the space that was picked.
  const form = useFieldErrors(["spaceId"]);
  const formId = useId();
  const chosen = spaceId || spaces?.[0]?.id || "";

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!chosen) return;
    setBusy(true);
    form.begin();
    try {
      const res = await chatClient.addMember({
        spaceId: chosen,
        userId: user.id,
      });
      onAdded(res.space?.name ?? "the space");
    } catch (err) {
      form.fail(err);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Add ${user.displayName || `@${user.username}`} to a space`}
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
            disabled={busy || !chosen}
          >
            Add
          </button>
        </>
      }
    >
      <form
        id={formId}
        ref={form.formRef}
        className="modal-form"
        onSubmit={add}
      >
        {spaces && spaces.length === 0 ? (
          <p className="muted">You're not in any spaces to add them to.</p>
        ) : (
          <Field
            label="Space"
            hint="They join as a member right away, no invite link needed. Only spaces you belong to are listed."
            error={form.errors.spaceId}
          >
            <select
              value={chosen}
              onChange={(e) => setSpaceId(e.target.value)}
              // biome-ignore lint/a11y/noAutofocus: the one field in a small dialog
              autoFocus
            >
              {spaces?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </form>
    </Modal>
  );
}
