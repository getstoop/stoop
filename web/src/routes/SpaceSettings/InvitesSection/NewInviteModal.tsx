import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { chatClient } from "../../../api/clients";
import { inviteLink } from "../../../api/invites";
import { useInstanceStatus } from "../../../api/queries";
import { Field } from "../../../components/Field";
import { Input } from "../../../components/Input";
import { Modal } from "../../../components/Modal";
import { NumberInput } from "../../../components/NumberInput";
import { Select } from "../../../components/Select";
import type { Space } from "../../../gen/stoop/chat/v1/space_pb";
import { useFieldErrors } from "../../../hooks/useFieldErrors";

// Expiry presets, in seconds. 0 = never.
const EXPIRY_OPTIONS: { label: string; seconds: number }[] = [
  { label: "1 hour", seconds: 60 * 60 },
  { label: "1 day", seconds: 24 * 60 * 60 },
  { label: "7 days", seconds: 7 * 24 * 60 * 60 },
  { label: "30 days", seconds: 30 * 24 * 60 * 60 },
  { label: "Never", seconds: 0 },
];
const DEFAULT_EXPIRY = 7 * 24 * 60 * 60;

// The server's cap on a label (internal/chat/invites.go).
export const MAX_INVITE_LABEL = 60;

// New invite, from Space settings → Invites. Every field is in view
// before the invite exists: making one is a choice someone looked at.
// Once made, its link is on the clipboard and in the table.
export function NewInviteModal({
  space,
  onClose,
}: {
  space: Space;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: instanceStatus } = useInstanceStatus();
  const formId = useId();
  const [label, setLabel] = useState("");
  const [expiry, setExpiry] = useState(DEFAULT_EXPIRY);
  const [maxUses, setMaxUses] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useFieldErrors(["label", "expiresIn", "maxUses"]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    form.begin();
    const uses = maxUses.trim() === "" ? undefined : Number(maxUses);
    if (uses !== undefined && (!Number.isInteger(uses) || uses < 1)) {
      form.set(
        "maxUses",
        "A whole number of at least 1, or blank for unlimited.",
      );
      return;
    }
    setBusy(true);
    try {
      const res = await chatClient.createInvite({
        spaceId: space.id,
        label: label.trim(),
        expiresIn: expiry > 0 ? { seconds: BigInt(expiry) } : undefined,
        maxUses: uses,
      });
      // The link is what gets shared, so it is what Create puts on the
      // clipboard, as soon as the server answers: a browser ties the
      // clipboard to the click, and the refetch below would outlast it.
      // The row's Copy link is there if this can't be.
      if (res.invite) {
        try {
          await navigator.clipboard.writeText(
            inviteLink(res.invite.code, space.name, instanceStatus?.publicUrl),
          );
        } catch {
          // No clipboard (plain HTTP on a LAN) or a refused write: the
          // invite exists either way, and its row has Copy link.
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["invites", space.id] });
      onClose();
    } catch (err) {
      form.fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New invite"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="chip" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            className="primary"
            disabled={busy}
          >
            Create invite
          </button>
        </>
      }
    >
      <form
        id={formId}
        className="modal-form"
        ref={form.formRef}
        onSubmit={create}
      >
        <Field
          label="Label (optional)"
          hint="Only people who see the invites list see it. It helps you tell invites apart later."
          counter={`${label.length}/${MAX_INVITE_LABEL}`}
          error={form.errors.label}
        >
          <Input
            value={label}
            maxLength={MAX_INVITE_LABEL}
            placeholder="What is it for? e.g. Tuesday book club"
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        <div className="invite-fields">
          <Field label="Expires after" error={form.errors.expiresIn}>
            <Select
              value={expiry}
              onChange={(e) => setExpiry(Number(e.target.value))}
            >
              {EXPIRY_OPTIONS.map((o) => (
                <option key={o.seconds} value={o.seconds}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Max uses" error={form.errors.maxUses}>
            <NumberInput
              min={1}
              step={1}
              placeholder="Unlimited"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
            />
          </Field>
        </div>
        <p className="hint">
          Anyone with the link joins {space.name} as a member. A one-use invite
          that expires in a day is the safest way to let one person in.
        </p>
        {form.formError && (
          <p className="error" role="alert">
            {form.formError}
          </p>
        )}
      </form>
    </Modal>
  );
}
