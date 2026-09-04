import type { QueryClient } from "@tanstack/react-query";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { chatClient } from "../../api/clients";
import { dmTitle, useDirectMessages } from "../../api/dms";
import { errorText } from "../../api/errors";
import { channelsQuery, useMe, useSpaces } from "../../api/queries";
import { patchChannel, recomputeSpaceUnread } from "../../api/unreads";
import { ListHead } from "../../components/ListHead";
import type { Space } from "../../gen/stoop/chat/v1/space_pb";
import { notice } from "../../stores/dialogs";

// Everything you've turned off, in one list. Mute controls live where the
// thing is; this is the only place that can show you what you muted in a
// space you haven't opened in a month.
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

  const rows = [
    ...mutedSpaces.map((s) => (
      <MuteRow
        key={s.id}
        label={s.name}
        what={`the space ${s.name}`}
        onUnmute={() => unmuteSpace(s)}
      />
    )),
    ...mutedChannels.map(({ space, channel }) => (
      <MuteRow
        key={channel.id}
        label={`${space.name} › # ${channel.name}`}
        what={`#${channel.name}`}
        onUnmute={() => unmuteChannel(queryClient, space.id, channel.id)}
      />
    )),
    ...mutedDms.map((d) => (
      <MuteRow
        key={d.channel?.id}
        label={dmTitle(d, me?.id)}
        note="direct message"
        what={`the conversation with ${dmTitle(d, me?.id)}`}
        onUnmute={() => unmuteChannel(queryClient, "", d.channel?.id ?? "")}
      />
    )),
  ];

  return (
    <section className="card mutes-section">
      <h3>Muted</h3>
      <p className="hint">
        Nothing here interrupts you. Mentions still reach your activity.
      </p>
      {rows.length === 0 ? (
        <p className="muted small">You haven't muted anything.</p>
      ) : (
        <ul className="user-list table mute-list">
          <ListHead columns={["Muted", "", ""]} />
          {rows}
        </ul>
      )}
    </section>
  );
}

function MuteRow({
  label,
  note,
  what,
  onUnmute,
}: {
  label: string;
  note?: string;
  what: string;
  onUnmute: () => void;
}) {
  return (
    <li className="user-row mute-row">
      <div className="user-row-main">
        <strong className="mute-label">{label}</strong>
      </div>
      <span className="user-cell">{note}</span>
      <div className="user-row-actions">
        <button
          type="button"
          className="chip"
          aria-label={`Unmute ${what}`}
          onClick={onUnmute}
        >
          Unmute
        </button>
      </div>
    </li>
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
