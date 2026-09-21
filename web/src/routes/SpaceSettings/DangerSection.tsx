import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { chatClient } from "../../api/clients";
import { canDeleteSpace } from "../../api/permissions";
import { useMe, useMembers } from "../../api/queries";
import { Field } from "../../components/Field";
import { controlAttrs } from "../../components/fieldControl";
import type { Space } from "../../gen/stoop/chat/v1/space_pb";
import { useFieldErrors } from "../../hooks/useFieldErrors";
import { confirm, prompt } from "../../stores/dialogs";

export function DangerSection({ space }: { space: Space }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: members } = useMembers(space.id);
  const { data: me } = useMe();
  const [target, setTarget] = useState("");
  const form = useFieldErrors(["userId"]);
  const others = (members ?? []).filter((m) => m.userId !== me?.id);

  const transfer = async () => {
    const to = others.find((m) => m.userId === target);
    if (!to) return;
    const ok = await confirm({
      title: `Make ${to.displayName || to.username} the owner of ${space.name}?`,
      body: "You'll become an admin.",
      action: "Transfer ownership",
    });
    if (!ok) return;
    form.begin();
    try {
      await chatClient.transferOwnership({
        spaceId: space.id,
        userId: to.userId,
      });
      await queryClient.invalidateQueries({ queryKey: ["spaces"] });
      await queryClient.invalidateQueries({ queryKey: ["members", space.id] });
      setTarget("");
    } catch (err) {
      form.fail(err);
    }
  };

  return (
    <section className="card danger-zone">
      <h3>Owner</h3>
      <p className="hint">
        Transfer ownership to another member. You'll stay on as an admin.
      </p>
      <Field label="New owner" error={form.errors.userId}>
        {(control) => (
          <div className="card-row">
            <select
              {...controlAttrs(control)}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">Choose a member…</option>
              {others.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName || m.username} (@{m.username})
                </option>
              ))}
            </select>
            <button
              type="button"
              className="chip"
              onClick={transfer}
              disabled={!target}
            >
              Transfer ownership
            </button>
          </div>
        )}
      </Field>
      <DeleteSpace space={space} onDeleted={() => navigate({ to: "/" })} />
    </section>
  );
}

// Instance admins may delete a space they don't own.
export function InstanceAdminDelete({ space }: { space: Space }) {
  const navigate = useNavigate();
  if (!canDeleteSpace(space)) return null;
  return (
    <section className="card danger-zone">
      <h3>Server admin</h3>
      <DeleteSpace space={space} onDeleted={() => navigate({ to: "/" })} />
    </section>
  );
}

function DeleteSpace({
  space,
  onDeleted,
}: {
  space: Space;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const remove = () =>
    prompt({
      title: "Delete this space",
      body: `This deletes ${space.name} and everything in it. Type the space name to confirm.`,
      label: "Space name",
      match: space.name,
      action: "Delete space",
      danger: true,
      submit: async () => {
        await chatClient.deleteSpace({ spaceId: space.id });
        await queryClient.invalidateQueries({ queryKey: ["spaces"] });
        onDeleted();
      },
    });
  return (
    <div className="card-row">
      <button type="button" className="chip danger" onClick={remove}>
        Delete this space
      </button>
      <span className="muted small">
        Permanent. Deletes every channel and message.
      </span>
    </div>
  );
}
