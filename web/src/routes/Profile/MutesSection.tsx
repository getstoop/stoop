import type { QueryClient } from "@tanstack/react-query";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { chatClient } from "../../api/clients";
import { dmTitle, useDirectMessages } from "../../api/dms";
import { errorText } from "../../api/errors";
import { channelsQuery, useMe, useSpaces } from "../../api/queries";
import { patchChannel, recomputeSpaceUnread } from "../../api/unreads";
import { DataTable, type TableColumn } from "../../components/DataTable";
import type { Space } from "../../gen/stoop/chat/v1/space_pb";
import { notice } from "../../stores/dialogs";

// Everything you've turned off, in one list. Mute controls live where the
// thing is; this is the only place that can show you what you muted in a
// space you haven't opened in a month.
type MuteRow = {
  id: string;
  label: string;
  note: string;
  // Names the thing for the button: "Unmute #general".
  what: string;
  onUnmute: () => void;
};

const columns: TableColumn<MuteRow>[] = [
  {
    id: "muted",
    header: "Muted",
    accessorFn: (r) => r.label,
    cell: ({ row: { original: r } }) => (
      <strong className="mute-label">{r.label}</strong>
    ),
  },
  {
    id: "note",
    header: "",
    enableSorting: false,
    meta: { width: "30%" },
    cell: ({ row: { original: r } }) => (
      <span className="mute-note">{r.note}</span>
    ),
  },
  {
    id: "actions",
    header: "",
    enableSorting: false,
    meta: { width: 110, actions: true },
    cell: ({ row: { original: r } }) => (
      <button
        type="button"
        className="chip"
        aria-label={`Unmute ${r.what}`}
        onClick={r.onUnmute}
      >
        Unmute
      </button>
    ),
  },
];

export function MutesSection() {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const { data: spaces } = useSpaces();
  const { data: dms } = useDirectMessages();

  const mutedSpaces = spaces?.filter((s) => s.muted) ?? [];
  // Channel mutes are only listed for spaces that aren't muted themselves:
  // a muted space's row already covers everything under it. One query per
  // space, asked for together rather than a hook per space.
  const openSpaces = spaces?.filter((s) => !s.muted) ?? [];
  const channelLists = useQueries({
    queries: openSpaces.map((s) => channelsQuery(s.id)),
  });
  const mutedChannels = openSpaces.flatMap((space, i) =>
    (channelLists[i]?.data ?? [])
      .filter((c) => c.muted)
      .map((channel) => ({ space, channel })),
  );
  const mutedDms = dms?.filter((d) => d.channel?.muted) ?? [];

  const unmuteSpace = async (space: Space) => {
    try {
      await chatClient.setSpaceMuted({ spaceId: space.id, muted: false });
      queryClient.setQueryData<Space[]>(["spaces"], (old) =>
        old?.map((s) => (s.id === space.id ? { ...s, muted: false } : s)),
      );
      queryClient.invalidateQueries({ queryKey: ["activity"] });
    } catch (err) {
      notice({ title: "Couldn't unmute the space", body: errorText(err) });
    }
  };

  const rows: MuteRow[] = [
    ...mutedSpaces.map((s) => ({
      id: s.id,
      label: s.name,
      note: "",
      what: `the space ${s.name}`,
      onUnmute: () => unmuteSpace(s),
    })),
    ...mutedChannels.map(({ space, channel }) => ({
      id: channel.id,
      label: `${space.name} › # ${channel.name}`,
      note: "",
      what: `#${channel.name}`,
      onUnmute: () => unmuteChannel(queryClient, space.id, channel.id),
    })),
    ...mutedDms.map((d) => ({
      id: d.channel?.id ?? "",
      label: dmTitle(d, me?.id),
      note: "direct message",
      what: `the conversation with ${dmTitle(d, me?.id)}`,
      onUnmute: () => unmuteChannel(queryClient, "", d.channel?.id ?? ""),
    })),
  ];
  // The table wants the same array until what is muted changes.
  const key = rows.map((r) => `${r.id}:${r.label}`).join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: key stands in for rows
  const stableRows = useMemo(() => rows, [key]);

  return (
    <section className="card mutes-section">
      <h3>Muted</h3>
      <p className="hint">
        Nothing here interrupts you. Mentions still reach your activity.
      </p>
      <DataTable
        rows={stableRows}
        columns={columns}
        rowId={(r) => r.id}
        noun={["mute", "mutes"]}
        empty="You haven't muted anything."
      />
    </section>
  );
}

// The same patches the channel row's menu makes, so the rail and the
// feed's mute stamps follow an unmute from here.
async function unmuteChannel(
  queryClient: QueryClient,
  spaceId: string,
  channelId: string,
) {
  try {
    await chatClient.setChannelMuted({ channelId, muted: false });
    patchChannel(queryClient, spaceId, channelId, { muted: false });
    if (spaceId) recomputeSpaceUnread(queryClient, spaceId);
    queryClient.invalidateQueries({ queryKey: ["activity"] });
  } catch (err) {
    notice({ title: "Couldn't unmute the channel", body: errorText(err) });
  }
}
