import { useState } from "react";
import { chatClient } from "../api/clients";
import { errorText } from "../api/errors";
import { useSpaces } from "../api/queries";
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
  const [error, setError] = useState<string | null>(null);
  const chosen = spaceId || spaces?.[0]?.id || "";

  const add = async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const res = await chatClient.addMember({
        spaceId: chosen,
        userId: user.id,
      });
      onAdded(res.space?.name ?? "the space");
    } catch (err) {
      setError(errorText(err));
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
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={add}
            disabled={busy || !chosen}
          >
            Add
          </button>
        </>
      }
    >
      {spaces && spaces.length === 0 ? (
        <p className="muted">You're not in any spaces to add them to.</p>
      ) : (
        <label>
          Space
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
        </label>
      )}
      <p className="hint">
        They join as a member right away, no invite link needed. Only spaces you
        belong to are listed.
      </p>
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}
