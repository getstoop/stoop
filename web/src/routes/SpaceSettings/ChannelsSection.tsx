import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { defaultChannelChoices, editChannelTopic } from "../../api/channels";
import { chatClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { useChannels } from "../../api/queries";
import { ListHead } from "../../components/ListHead";
import { SettingRow } from "../../components/SettingRow";
import type { Channel } from "../../gen/stoop/chat/v1/channel_pb";
import type { Space } from "../../gen/stoop/chat/v1/space_pb";
import { confirm } from "../../stores/dialogs";

export function ChannelsSection({ space }: { space: Space }) {
  const queryClient = useQueryClient();
  const { data: channels } = useChannels(space.id);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  );

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["channels", space.id] });
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(errorText(err));
    }
  };
  const move = (list: Channel[], index: number, dir: -1 | 1) => {
    const next = [...list];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    act(() =>
      chatClient.reorderChannels({
        spaceId: space.id,
        channelIds: next.map((c) => c.id),
      }),
    );
  };
  const remove = async (c: Channel) => {
    const ok = await confirm({
      title: `Delete #${c.name}?`,
      body: "All its messages go with it.",
      action: "Delete",
      danger: true,
    });
    if (ok) act(() => chatClient.deleteChannel({ channelId: c.id }));
  };
  const saveRename = () => {
    if (!renaming) return;
    const name = renaming.name.trim();
    const id = renaming.id;
    setRenaming(null);
    if (name) act(() => chatClient.updateChannel({ channelId: id, name }));
  };

  return (
    <section className="card">
      <h3>Channels</h3>
      <ul className="user-list table channels">
        <ListHead columns={["Channel", "Topic", ""]} />
        {channels?.map((c, i) => (
          <li key={c.id} className="user-row">
            <div className="user-row-main">
              {renaming?.id === c.id ? (
                <input
                  value={renaming.name}
                  onChange={(e) =>
                    setRenaming({ id: c.id, name: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveRename();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  onBlur={saveRename}
                  maxLength={100}
                  aria-label="Channel name"
                />
              ) : (
                <strong># {c.name}</strong>
              )}
            </div>
            <span className="user-cell">{c.topic || "No topic"}</span>
            <div className="user-row-actions">
              <button
                type="button"
                className="chip"
                onClick={() => move(channels, i, -1)}
                disabled={i === 0}
                title="Move up"
              >
                ↑
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => move(channels, i, 1)}
                disabled={i === channels.length - 1}
                title="Move down"
              >
                ↓
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => setRenaming({ id: c.id, name: c.name })}
              >
                Rename
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => editChannelTopic(c, queryClient)}
              >
                Topic
              </button>
              <button
                type="button"
                className="chip danger"
                onClick={() => remove(c)}
                disabled={channels.length <= 1}
                title={
                  channels.length <= 1
                    ? "A space needs at least one channel"
                    : "Delete channel"
                }
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      {channels && (
        <DefaultChannelRow
          space={space}
          channels={channels}
          onError={setError}
        />
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

// Where the space puts someone who arrives without a channel of their
// own: a new member following an invite, or anyone opening /s/{id} with
// nothing after it. Unset — "First channel" — is what every space did
// before this setting existed.
function DefaultChannelRow({
  space,
  channels,
  onError,
}: {
  space: Space;
  channels: Channel[];
  onError: (message: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const choices = defaultChannelChoices(channels);
  // A default naming a channel that isn't here is one that was deleted
  // without us hearing the event yet. Show it as unset, which is where
  // arrivals are already going.
  const current = choices.some((c) => c.id === space.defaultChannelId)
    ? space.defaultChannelId
    : "";
  // The value comes from the server, so without somewhere to hold the
  // pick it would snap back to the old channel until the save lands.
  // Holding it also closes the control while one save is in flight, so
  // two quick picks can't finish out of order.
  const [pending, setPending] = useState<string | null>(null);

  const choose = async (channelId: string) => {
    onError(null);
    setPending(channelId);
    try {
      await chatClient.updateSpace({
        spaceId: space.id,
        defaultChannelId: channelId,
      });
      await queryClient.invalidateQueries({ queryKey: ["spaces"] });
    } catch (err) {
      onError(errorText(err));
    } finally {
      setPending(null);
    }
  };

  return (
    <SettingRow
      id="default-channel"
      title="New members start in"
      description="Where an invite lands someone, and where the space opens when no channel is chosen."
    >
      <select
        id="default-channel"
        name="default-channel"
        value={pending ?? current}
        disabled={pending !== null}
        onChange={(e) => choose(e.target.value)}
      >
        <option value="">First channel</option>
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            # {c.name}
          </option>
        ))}
      </select>
    </SettingRow>
  );
}
