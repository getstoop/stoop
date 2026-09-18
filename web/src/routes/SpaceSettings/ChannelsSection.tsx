import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import {
  defaultChannelChoices,
  editChannelTopic,
  isAnnouncement,
  setAnnouncement,
} from "../../api/channels";
import { chatClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { useChannels } from "../../api/queries";
import { DataTable, type TableColumn } from "../../components/DataTable";
import { DotsMenu } from "../../components/DotsMenu";
import { SettingRow } from "../../components/SettingRow";
import { SpeakerIcon } from "../../components/VoiceIcons";
import { type Channel, ChannelKind } from "../../gen/stoop/chat/v1/channel_pb";
import type { Space } from "../../gen/stoop/chat/v1/space_pb";
import { confirm } from "../../stores/dialogs";

export function ChannelsSection({ space }: { space: Space }) {
  const queryClient = useQueryClient();
  const { data: channels } = useChannels(space.id);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; text: string } | null>(
    null,
  );
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  );

  const act = async (c: Channel, fn: () => Promise<unknown>) => {
    setFailed(null);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: ["channels", space.id] });
    } catch (err) {
      setFailed({ id: c.id, text: errorText(err) });
    }
  };
  const move = (c: Channel, index: number, dir: -1 | 1) => {
    const next = [...(channels ?? [])];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    act(c, () =>
      chatClient.reorderChannels({
        spaceId: space.id,
        channelIds: next.map((n) => n.id),
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
    if (ok) act(c, () => chatClient.deleteChannel({ channelId: c.id }));
  };
  const saveRename = (c: Channel) => {
    if (!renaming) return;
    const name = renaming.name.trim();
    setRenaming(null);
    if (name) act(c, () => chatClient.updateChannel({ channelId: c.id, name }));
  };

  // The cells read this render's state and handlers through a ref, so
  // the columns stay stable and the rename input keeps its focus.
  const view = { channels, renaming, setRenaming, saveRename, move, remove };
  const latest = useRef(view);
  latest.current = view;

  const columns = useMemo<TableColumn<Channel>[]>(
    () => [
      {
        id: "channel",
        header: "Channel",
        meta: { width: "24%" },
        cell: ({ row: { original: c } }) => {
          const v = latest.current;
          if (v.renaming?.id !== c.id) return <ChannelName channel={c} />;
          return (
            <input
              // biome-ignore lint/a11y/noAutofocus: opened by choosing Rename
              autoFocus
              value={v.renaming.name}
              onChange={(e) =>
                v.setRenaming({ id: c.id, name: e.target.value })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") v.saveRename(c);
                if (e.key === "Escape") v.setRenaming(null);
              }}
              onBlur={() => v.saveRename(c)}
              maxLength={100}
              aria-label="Channel name"
            />
          );
        },
      },
      {
        id: "topic",
        header: "Topic",
        cell: ({ row: { original: c } }) => c.topic || "No topic",
      },
      {
        id: "announcement",
        header: "Announcement",
        meta: { width: 130, align: "center" },
        cell: ({ row: { original: c } }) =>
          c.kind === ChannelKind.TEXT ? (
            <input
              type="checkbox"
              name={`announcement-${c.id}`}
              checked={isAnnouncement(c)}
              onChange={(e) =>
                setAnnouncement(c, e.target.checked, queryClient)
              }
              aria-label={`#${c.name} is an announcement channel`}
            />
          ) : (
            <span title="Only text channels can be announcement channels">
              —
            </span>
          ),
      },
      {
        id: "actions",
        header: "",
        meta: { width: 150, actions: true },
        cell: ({ row: { original: c, index } }) => {
          const v = latest.current;
          const count = v.channels?.length ?? 0;
          return (
            <>
              <button
                type="button"
                className="chip"
                onClick={() => v.move(c, index, -1)}
                disabled={index === 0}
                title="Move up"
              >
                ↑
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => v.move(c, index, 1)}
                disabled={index === count - 1}
                title="Move down"
              >
                ↓
              </button>
              <DotsMenu
                label={`Actions for #${c.name}`}
                items={[
                  {
                    label: "Rename",
                    onSelect: () => v.setRenaming({ id: c.id, name: c.name }),
                  },
                  {
                    label: "Edit topic",
                    onSelect: () => editChannelTopic(c, queryClient),
                  },
                  {
                    label: "Delete",
                    danger: true,
                    disabled: count <= 1,
                    title:
                      count <= 1
                        ? "A space needs at least one channel"
                        : "Delete channel",
                    onSelect: () => v.remove(c),
                  },
                ]}
              />
            </>
          );
        },
      },
    ],
    [queryClient],
  );

  return (
    <section className="card">
      <h3>Channels</h3>
      <DataTable
        rows={channels}
        columns={columns}
        rowId={(c) => c.id}
        noun={["channel", "channels"]}
        empty="No channels yet."
        ordered
        rowError={(c) => (failed && failed.id === c.id ? failed.text : null)}
      />
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

function ChannelName({ channel: c }: { channel: Channel }) {
  return (
    <strong className="dt-channel">
      {c.kind === ChannelKind.VOICE ? <SpeakerIcon /> : "#"} {c.name}
    </strong>
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
