import { useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, Outlet } from "@tanstack/react-router";
import { dmOther, dmTitle, useDirectMessages } from "../api/dms";
import { isMuted } from "../api/mutes";
import { useMe } from "../api/queries";
import { presenceClass } from "../api/status";
import { badgeCount, isAlerting } from "../api/unreads";
import { Avatar } from "../components/Avatar";
import { ChannelMenu } from "../components/ChannelMenu";
import { closeDrawerOnLink } from "../components/MenuButton";
import { useConnectionStore } from "../stores/connection";

// /dm: the direct-message list in the sidebar slot (so the phone drawer
// works unchanged), the conversation via Outlet. A DM is a channel with
// no space; ChannelView renders it with spaceId "".
export function DMLayout() {
  const queryClient = useQueryClient();
  const { data: dms } = useDirectMessages();
  const { data: me } = useMe();
  const online = useConnectionStore((s) => s.online);
  const presence = useConnectionStore((s) => s.presence);

  return (
    <>
      <aside className="channel-sidebar" onClickCapture={closeDrawerOnLink}>
        <header className="sidebar-header">
          <span className="space-name">Direct messages</span>
        </header>
        <div className="channel-list dm-list">
          {dms?.map((dm) => {
            const other = dmOther(dm, me?.id);
            const channel = dm.channel;
            if (!channel) return null;
            const unread = isAlerting(queryClient, "", channel);
            const muted = isMuted(queryClient, "", channel.id) ? "muted" : "";
            return (
              <div key={channel.id} className="channel-row">
                <Link
                  to="/dm/$channelId"
                  params={{ channelId: channel.id }}
                  className={`channel-link dm-link ${unread ? "unread" : ""} ${muted}`}
                  activeProps={{
                    className: `channel-link dm-link active ${unread ? "unread" : ""} ${muted}`,
                  }}
                >
                  <Avatar
                    name={dmTitle(dm, me?.id)}
                    fileId={other?.avatarFileId}
                    size="small"
                  >
                    {other && online.has(other.id) && (
                      <span
                        className={`online-dot ${presenceClass(presence[other.id])}`}
                      />
                    )}
                  </Avatar>
                  <span className="channel-name">{dmTitle(dm, me?.id)}</span>
                  {channel.unreadCount > 0 && !channel.muted && (
                    <span className="channel-badge">
                      {badgeCount(channel.unreadCount)}
                    </span>
                  )}
                </Link>
                <ChannelMenu channel={channel} />
              </div>
            );
          })}
          {dms && dms.length === 0 && (
            <p className="muted small dm-empty">
              No conversations yet. Click someone's name and choose Message.
            </p>
          )}
        </div>
      </aside>
      <Outlet />
    </>
  );
}

// /dm with nothing picked: the most recent conversation, or a hint.
export function DMIndex() {
  const { data: dms, isLoading } = useDirectMessages();
  if (isLoading) {
    return <div className="centered muted">Loading…</div>;
  }
  const first = dms?.[0]?.channel;
  if (first) {
    return <Navigate to="/dm/$channelId" params={{ channelId: first.id }} />;
  }
  return (
    <div className="centered">
      <div className="empty-state">
        <h2>Direct messages</h2>
        <p className="muted">
          Open someone's profile from a message or the member list and choose
          Message.
        </p>
      </div>
    </div>
  );
}

// The channel header for a DM: the other person, with presence.
export function DMTitle({ channelId }: { channelId: string }) {
  const { data: dms } = useDirectMessages();
  const { data: me } = useMe();
  const dm = dms?.find((d) => d.channel?.id === channelId);
  const other = dm ? dmOther(dm, me?.id) : undefined;
  const otherId = other?.id ?? "";
  const isOnline = useConnectionStore(
    (s) => otherId !== "" && s.online.has(otherId),
  );
  const status = useConnectionStore((s) => s.presence[otherId]);
  if (!dm) return <span className="channel-hash">…</span>;
  return (
    <span className="dm-title">
      <Avatar
        name={dmTitle(dm, me?.id)}
        fileId={other?.avatarFileId}
        size="small"
      >
        {isOnline && <span className={`online-dot ${presenceClass(status)}`} />}
      </Avatar>
      <span>{dmTitle(dm, me?.id)}</span>
      {other && <span className="muted dm-handle">@{other.username}</span>}
    </span>
  );
}
