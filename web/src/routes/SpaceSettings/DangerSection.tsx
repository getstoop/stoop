import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { chatClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { useMe, useMembers } from "../../api/queries";
import { InstanceRole } from "../../gen/stoop/auth/v1/auth_pb";
import type { Space } from "../../gen/stoop/chat/v1/space_pb";
import { confirm, prompt } from "../../stores/dialogs";

export function DangerSection({ space }: { space: Space }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: members } = useMembers(space.id);
  const { data: me } = useMe();
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
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
    setError(null);
    try {
      await chatClient.transferOwnership({
        spaceId: space.id,
        userId: to.userId,
      });
      await queryClient.invalidateQueries({ queryKey: ["spaces"] });
      await queryClient.invalidateQueries({ queryKey: ["members", space.id] });
      setTarget("");
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <section className="card danger-zone">
      <h3>Owner</h3>
      <p className="hint">
        Transfer ownership to another member. You'll stay on as an admin.
      </p>
      <div className="card-row">
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          aria-label="New owner"
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
      <DeleteSpace
        space={space}
        onDeleted={() => navigate({ to: "/" })}
        setError={setError}
      />
      {error && <p className="error">{error}</p>}
    </section>
  );
}

// Instance admins may delete a space they don't own.
export function InstanceAdminDelete({ space }: { space: Space }) {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  if (me?.role !== InstanceRole.ADMIN) return null;
  return (
    <section className="card danger-zone">
      <h3>Server admin</h3>
      <DeleteSpace
        space={space}
        onDeleted={() => navigate({ to: "/" })}
        setError={setError}
      />
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function DeleteSpace({
  space,
  onDeleted,
  setError,
}: {
  space: Space;
  onDeleted: () => void;
  setError: (e: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const remove = async () => {
    const typed = await prompt({
      title: "Delete this space",
      body: `This deletes ${space.name} and everything in it. Type the space name to confirm.`,
      label: "Space name",
      match: space.name,
      action: "Delete space",
      danger: true,
    });
    if (typed !== space.name) return;
    setError(null);
    try {
      await chatClient.deleteSpace({ spaceId: space.id });
      await queryClient.invalidateQueries({ queryKey: ["spaces"] });
      onDeleted();
    } catch (err) {
      setError(errorText(err));
    }
  };
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
