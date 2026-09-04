import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Fragment, useState } from "react";
import { activityVerb, markActivityRead } from "../api/activity";
import { chatClient } from "../api/clients";
import { dayLabel, fullDateTime, sameDay } from "../api/dates";
import { useActivity, useChannels, useSpaces } from "../api/queries";
import { Avatar } from "../components/Avatar";
import { MenuButton } from "../components/MenuButton";
import type { ActivityItem } from "../gen/stoop/chat/v1/activity_pb";

// The activity timeline: everything that has happened to you, newest
// first, in the channel view's shape — a header bar, then rows. The
// first page comes from the shared cache (so it's the same list the
// badges are derived from); older pages are loaded on demand.
export function ActivityPage() {
  const { data } = useActivity();
  const [older, setOlder] = useState<ActivityItem[]>([]);
  const [exhausted, setExhausted] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const queryClient = useQueryClient();

  const recent = data?.items ?? [];
  const all = [
    ...recent,
    ...older.filter((o) => !recent.some((r) => r.id === o.id)),
  ];

  const loadMore = async () => {
    const last = all[all.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const res = await chatClient.listActivity({ beforeId: last.id });
      setOlder((o) => [...o, ...res.items]);
      if (res.items.length === 0) setExhausted(true);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="activity-page">
      <header className="channel-header activity-page-header">
        <MenuButton />
        <span>Activity</span>
        <span className="muted activity-count">
          {data && data.unreadCount > 0
            ? `${data.unreadCount} unread`
            : "You're all caught up."}
        </span>
        {data && data.unreadCount > 0 && (
          <button
            type="button"
            className="chip"
            onClick={() => markActivityRead(queryClient, "all")}
          >
            Mark all read
          </button>
        )}
      </header>

      <div className="activity-scroll">
        {all.length === 0 && (
          <p className="muted empty-state">
            When someone @mentions you, it shows up here.
          </p>
        )}
        <ul className="activity-list">
          {all.map((item, i) => (
            <Fragment key={item.id}>
              {item.createdAt && startsDay(item, all[i - 1]) && (
                <li className="day-divider">
                  <span>{dayLabel(timestampDate(item.createdAt))}</span>
                </li>
              )}
              <li>
                <ActivityRow item={item} />
              </li>
            </Fragment>
          ))}
        </ul>
        {all.length > 0 && !exhausted && (
          <button
            type="button"
            className="chip activity-more"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading…" : "Load older"}
          </button>
        )}
      </div>
    </div>
  );
}

// Newest first, so the day changes where the item above belongs to
// another one; the first item always opens its day.
function startsDay(item: ActivityItem, prev: ActivityItem | undefined) {
  return (
    !prev?.createdAt ||
    !item.createdAt ||
    !sameDay(timestampDate(prev.createdAt), timestampDate(item.createdAt))
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const { data: spaces } = useSpaces();
  const { data: channels } = useChannels(item.spaceId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const space = spaces?.find((s) => s.id === item.spaceId);
  const channel = channels?.find((c) => c.id === item.channelId);
  const who = item.actor?.displayName || item.actor?.username || "Someone";

  const open = async () => {
    if (!item.readAt) await markActivityRead(queryClient, [item.id]);
    if (item.spaceId) {
      navigate({
        to: "/s/$spaceId/c/$channelId",
        params: { spaceId: item.spaceId, channelId: item.channelId },
        search: item.messageId ? { m: item.messageId } : {},
      });
    } else {
      navigate({
        to: "/dm/$channelId",
        params: { channelId: item.channelId },
        search: item.messageId ? { m: item.messageId } : {},
      });
    }
  };

  return (
    <button
      type="button"
      className={`activity-row ${item.readAt ? "" : "unread"}`}
      onClick={open}
    >
      <Avatar
        name={who}
        fileId={item.actor?.avatarFileId ?? ""}
        size="medium"
      />
      <span className="activity-title">
        <strong>{who}</strong> {activityVerb(item.kind)}
        {item.spaceId && <> in #{channel?.name ?? "…"}</>}
        {space && <span className="muted"> · {space.name}</span>}
      </span>
      <span
        className="muted small activity-time"
        title={
          item.createdAt ? fullDateTime(timestampDate(item.createdAt)) : ""
        }
      >
        {item.createdAt ? relativeTime(timestampDate(item.createdAt)) : ""}
      </span>
      {item.preview && <span className="activity-preview">{item.preview}</span>}
    </button>
  );
}

// Recent items say how long ago; past that the day divider above the row
// carries the date, so the row only needs the time of day.
function relativeTime(d: Date): string {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
