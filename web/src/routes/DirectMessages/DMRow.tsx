import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { dmFaces, dmIsGroup, dmOther, dmTitle } from "../../api/dms";
import { isMuted } from "../../api/mutes";
import { useMe } from "../../api/queries";
import { presenceClass } from "../../api/status";
import { badgeCount, isAlerting } from "../../api/unreads";
import { AvatarStack } from "../../components/AvatarStack";
import { ChannelMenu } from "../../components/ChannelMenu";
import type { DirectMessage } from "../../gen/stoop/chat/v1/chat_pb";
import { useConnectionStore } from "../../stores/connection";

// One conversation in the DM list. A presence dot belongs to a 1:1: in a
// group, "who of the four is online" is a question for the header, not a
// dot on one of two faces.
export function DMRow({ dm }: { dm: DirectMessage }) {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const online = useConnectionStore((s) => s.online);
  const presence = useConnectionStore((s) => s.presence);
  const channel = dm.channel;
  if (!channel) return null;
  const other = dmIsGroup(dm) ? undefined : dmOther(dm, me?.id);
  const title = dmTitle(dm, me?.id);
  const unread = isAlerting(queryClient, "", channel) ? "unread" : "";
  const muted = isMuted(queryClient, "", channel.id) ? "muted" : "";

  return (
    <div className="channel-row">
      <Link
        to="/dm/$channelId"
        params={{ channelId: channel.id }}
        className={`channel-link dm-link ${unread} ${muted}`}
        activeProps={{
          className: `channel-link dm-link active ${unread} ${muted}`,
        }}
      >
        <AvatarStack people={dmFaces(dm, me?.id)} name={title} size="small">
          {other && online.has(other.id) && (
            <span
              className={`online-dot ${presenceClass(presence[other.id])}`}
            />
          )}
        </AvatarStack>
        <span className="channel-name">{title}</span>
        {channel.unreadCount > 0 && !channel.muted && (
          <span className="channel-badge">
            {badgeCount(channel.unreadCount)}
          </span>
        )}
      </Link>
      <ChannelMenu channel={channel} />
    </div>
  );
}
