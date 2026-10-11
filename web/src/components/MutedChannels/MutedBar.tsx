import { mutedByCaller } from "../../api/mutes";
import type { Channel } from "../../gen/stoop/chat/v1/channel_pb";
import { useLayoutStore } from "../../stores/layout";
import { openSidePanel, useSidePanelStore } from "../../stores/sidePanel";
import { BellOffIcon, ChevronIcon } from "../Icons";

// The way to the muted channels, on top of the members list. It is there
// only while the reader has muted channels in this space, or its panel is
// open.
export function MutedBar({
  spaceId,
  channels,
}: {
  spaceId: string;
  channels: Channel[] | undefined;
}) {
  const showing = useSidePanelStore(
    (state) =>
      state.open?.kind === "muted" && state.open.params.spaceId === spaceId,
  );
  if (!showing && !channels?.some(mutedByCaller)) return null;

  const open = () => {
    // A button, and only links close the drawer.
    useLayoutStore.getState().closeDrawer();
    if (!showing) openSidePanel("muted", { spaceId });
  };

  return (
    <button
      type="button"
      className={`muted-bar${showing ? " on" : ""}`}
      aria-expanded={showing}
      onClick={open}
    >
      <BellOffIcon size={16} />
      <span className="muted-bar-label">Muted channels</span>
      <ChevronIcon />
    </button>
  );
}
