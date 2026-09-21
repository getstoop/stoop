import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { chatClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { useChannels } from "../../api/queries";
import { type Channel, ChannelKind } from "../../gen/stoop/chat/v1/channel_pb";
import type { Space } from "../../gen/stoop/chat/v1/space_pb";
import { confirm } from "../../stores/dialogs";
import { ChannelTable } from "./ChannelTable";
import { DefaultChannelRow } from "./DefaultChannelRow";
import { EditChannelModal } from "./EditChannelModal";

export function ChannelsSection({ space }: { space: Space }) {
  const queryClient = useQueryClient();
  const { data: channels } = useChannels(space.id);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; text: string } | null>(
    null,
  );
  const [editing, setEditing] = useState<Channel | null>(null);

  // Each table gets its own rows, held across renders: a new array every
  // render would rebuild the table's row model for nothing.
  const text = useMemo(
    () => channels?.filter((c) => c.kind !== ChannelKind.VOICE),
    [channels],
  );
  const voice = useMemo(
    () => channels?.filter((c) => c.kind === ChannelKind.VOICE),
    [channels],
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
  const remove = async (c: Channel) => {
    const ok = await confirm({
      title: `Delete #${c.name}?`,
      body: "All its messages go with it.",
      action: "Delete",
      danger: true,
    });
    if (ok) act(c, () => chatClient.deleteChannel({ channelId: c.id }));
  };

  // A drop can land while the one before it is still in flight, and the
  // server writes each request in its own transaction — so two overlapping
  // saves can commit in either order and the earlier drag can win. Each
  // save waits for the one before it.
  const saving = useRef<Promise<void>>(Promise.resolve());

  // The sidebar keeps voice channels in their own group below the text
  // ones, so a space's saved order is every text channel and then every
  // voice one. A drag in either table writes the whole sequence back that
  // way, which also settles a space whose positions still interleave.
  const saveOrder = (textIds: string[], voiceIds: string[]) => {
    const channelIds = [...textIds, ...voiceIds];
    setError(null);
    const rank = new Map(channelIds.map((id, i) => [id, i]));
    queryClient.setQueryData<Channel[]>(
      ["channels", space.id],
      (old) =>
        old &&
        [...old].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)),
    );
    saving.current = saving.current
      .then(() => chatClient.reorderChannels({ spaceId: space.id, channelIds }))
      .then(
        () => {},
        async (err) => {
          setError(errorText(err));
          await queryClient.invalidateQueries({
            queryKey: ["channels", space.id],
          });
        },
      );
  };
  const ids = (list: Channel[] | undefined) => (list ?? []).map((c) => c.id);

  const table = {
    total: channels?.length ?? 0,
    onEdit: setEditing,
    onDelete: remove,
    rowError: (c: Channel) =>
      failed && failed.id === c.id ? failed.text : null,
  };

  return (
    <>
      <section className="card">
        <h3>Text channels</h3>
        <ChannelTable
          {...table}
          kind={ChannelKind.TEXT}
          channels={text}
          onReorder={(textIds) => saveOrder(textIds, ids(voice))}
        />
        {channels && <DefaultChannelRow space={space} channels={channels} />}
      </section>
      <section className="card">
        <h3>Voice channels</h3>
        <ChannelTable
          {...table}
          kind={ChannelKind.VOICE}
          channels={voice}
          onReorder={(voiceIds) => saveOrder(ids(text), voiceIds)}
        />
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {editing && (
        <EditChannelModal channel={editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
