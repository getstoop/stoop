import type { QueryClient } from "@tanstack/react-query";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { chatClient } from "../../api/clients";
import { dmTitle, useDirectMessages } from "../../api/dms";
import { errorText } from "../../api/errors";
import { channelsQuery, useMe, useSpaces } from "../../api/queries";
import { setThreadMuted } from "../../api/threads";
import { patchChannel, recomputeSpaceUnread } from "../../api/unreads";
import { DataTable, type TableColumn } from "../../components/DataTable";
import type { Message } from "../../gen/stoop/chat/v1/message_pb";
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
  const { data: mutedThreads, isError: threadsFailed } = useQuery({
    queryKey: ["threadMutes"],
    queryFn: async () => (await chatClient.listThreadMutes({})).threads,
  });
  // Where a muted thread is, from the lists already loaded above.
  const threadPlace = (spaceId: string, channelId: string) => {
    if (!spaceId) {
      const dm = dms?.find((d) => d.channel?.id === channelId);
      return dm ? dmTitle(dm, me?.id) : "direct message";
    }
    const index = openSpaces.findIndex((s) => s.id === spaceId);
    const space = spaces?.find((s) => s.id === spaceId);
    const channel = channelLists[index]?.data?.find((c) => c.id === channelId);
    // A muted space's channels aren't loaded here; its name will do.
    if (!channel) return space?.name ?? "a space";
    return `${space?.name ?? "a space"} › # ${channel.name}`;
  };

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
    ...(mutedThreads ?? []).map((t) => ({
      id: t.root?.id ?? "",
      label: threadExcerpt(t.root),
      note: `thread · ${threadPlace(t.spaceId, t.channelId)}`,
      what: "the thread",
      onUnmute: () => unmuteThread(queryClient, t.channelId, t.root?.id ?? ""),
    })),
  ];
  // The table wants the same array until what is muted changes.
  const key = rows.map((r) => `${r.id}:${r.label}:${r.note}`).join("|");
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
      {threadsFailed && (
        <p className="error" role="alert">
          Couldn't load your muted threads.
        </p>
      )}
    </section>
  );
}

// A muted thread is named by its first message.
function threadExcerpt(root: Message | undefined) {
  if (!root || root.deleted) return "Original message deleted";
  const who = root.author?.displayName || root.author?.username || "?";
  const text = root.content.replace(/\s+/g, " ").trim();
  return `${who}: ${text.length > 60 ? `${text.slice(0, 60)}…` : text}`;
}

async function unmuteThread(
  queryClient: QueryClient,
  channelId: string,
  rootId: string,
) {
  try {
    await setThreadMuted(queryClient, channelId, rootId, false);
  } catch (err) {
    notice({ title: "Couldn't unmute the thread", body: errorText(err) });
  }
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
