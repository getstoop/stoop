import { useChannelPeople } from "../../api/channelPeople";
import type { Channel } from "../../gen/stoop/chat/v1/channel_pb";
import { openSidePanel, useSidePanelStore } from "../../stores/sidePanel";
import { PeopleIcon } from "../Icons";

// In a private channel's header: how many people are in it, and the way
// to the panel that lists them.
export function PeopleButton({ channel }: { channel: Channel }) {
  const { data: people } = useChannelPeople(channel.id);
  const showing = useSidePanelStore(
    (state) =>
      state.open?.kind === "people" &&
      state.open.params.channelId === channel.id,
  );
  const close = useSidePanelStore((state) => state.close);
  const count = people?.length;
  return (
    <button
      type="button"
      className={`icon-button people-button${showing ? " on" : ""}`}
      aria-label={
        count === undefined
          ? "People in this channel"
          : `People in this channel, ${count}`
      }
      aria-expanded={showing}
      title="People in this channel"
      onClick={() =>
        showing
          ? close()
          : openSidePanel("people", {
              spaceId: channel.spaceId,
              channelId: channel.id,
            })
      }
    >
      <PeopleIcon />
      {count !== undefined && <span>{count}</span>}
    </button>
  );
}
