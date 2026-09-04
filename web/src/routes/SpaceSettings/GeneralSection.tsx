import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { chatClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { filesClient } from "../../api/files";
import { ImagePicker } from "../../components/ImagePicker";
import type { Space } from "../../gen/stoop/chat/v1/space_pb";

export function GeneralSection({ space }: { space: Space }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(space.name);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => setName(space.name), [space.name]);

  const update = async (patch: {
    name?: string;
    membersCanInvite?: boolean;
  }) => {
    setError(null);
    try {
      await chatClient.updateSpace({ spaceId: space.id, ...patch });
      await queryClient.invalidateQueries({ queryKey: ["spaces"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError(errorText(err));
    }
  };
  const rename = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() && name.trim() !== space.name)
      update({ name: name.trim() });
  };

  return (
    <section className="card">
      <h3>General</h3>
      <form className="card-row" onSubmit={rename}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          required
          aria-label="Space name"
        />
        <button
          type="submit"
          className="primary"
          disabled={name.trim() === space.name}
        >
          {saved ? "Saved" : "Rename"}
        </button>
      </form>
      <IconRow space={space} />
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={space.membersCanInvite}
          onChange={(e) => update({ membersCanInvite: e.target.checked })}
        />
        <span>
          <strong>Members can create invites</strong>
          <span className="muted small">
            {" "}
            — otherwise only admins and the owner can. Members' invites always
            grant the member role.
          </span>
        </span>
      </label>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

// The space icon: re-encoded server-side to a 512 px square PNG; members
// see it in the rail as soon as the SpaceUpdated event lands.
function IconRow({ space }: { space: Space }) {
  const queryClient = useQueryClient();
  const upload = async (bytes: Uint8Array) => {
    await filesClient.uploadSpaceIcon({ spaceId: space.id, data: bytes });
    await queryClient.invalidateQueries({ queryKey: ["spaces"] });
  };
  return (
    <div className="card-row icon-row">
      <span className="muted small">
        Icon — PNG, JPEG, GIF, or WebP up to 2 MB, cropped to a square.
      </span>
      <ImagePicker
        label={space.iconFileId ? "Change icon" : "Upload icon"}
        onPick={upload}
      />
    </div>
  );
}
