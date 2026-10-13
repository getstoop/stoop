import { Link } from "@tanstack/react-router";
import { useNarrowScreen } from "../../hooks/useNarrowScreen";
import { useSidePanelStore } from "../../stores/sidePanel";

// Where a thread lives, in its header: opens that channel on the thread's
// root. A narrow screen has the panel over the page, so the panel closes
// and the channel takes the history entry the panel added.
export function ThreadChannelLink({
  spaceId,
  channelId,
  rootId,
  label,
}: {
  spaceId: string;
  channelId: string;
  rootId: string;
  label: string;
}) {
  const close = useSidePanelStore((s) => s.close);
  const narrow = useNarrowScreen();
  const onClick = () => {
    if (narrow) close();
  };
  return spaceId ? (
    <Link
      className="thread-channel-link"
      to="/s/$spaceId/c/$channelId"
      params={{ spaceId, channelId }}
      search={{ m: rootId }}
      replace={narrow}
      onClick={onClick}
    >
      {label}
    </Link>
  ) : (
    <Link
      className="thread-channel-link"
      to="/dm/$channelId"
      params={{ channelId }}
      search={{ m: rootId }}
      replace={narrow}
      onClick={onClick}
    >
      {label}
    </Link>
  );
}
