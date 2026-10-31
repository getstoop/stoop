import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { markActivityRead } from "../../api/activity";
import { chatClient } from "../../api/clients";
import { useActivity } from "../../api/queries";
import { MenuButton } from "../../components/MenuButton";
import { startsDay, withOlderPages } from "../../core/activity";
import { dayLabel } from "../../core/dates";
import type { ActivityItem } from "../../gen/stoop/chat/v1/activity_pb";
import { ActivityRow } from "./ActivityRow";

// The activity inbox: everything that has happened to you, in two
// sections. New holds what is unread, newest first, with "Mark all read"
// on its heading; Read is the read history, the first row of each day
// carrying the day. The
// first page comes from the shared cache (so it is the same list the
// badges are derived from), and older pages load as the list is
// scrolled to its end. A row that is read moves from one section to the
// other because the cache stamps it, not because the page moves it.
export function ActivityPage() {
  const { data } = useActivity();
  const [older, setOlder] = useState<ActivityItem[]>([]);
  const [exhausted, setExhausted] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const queryClient = useQueryClient();

  const recent = data?.items ?? [];
  const all = withOlderPages(recent, older);
  const fresh = all.filter((item) => !item.readAt);
  const earlier = all.filter((item) => item.readAt);

  const loadMore = async () => {
    const last = all[all.length - 1];
    if (!last || loadingMore || exhausted) return;
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
      </header>

      <div className="activity-scroll">
        {data && all.length === 0 && (
          <p className="muted empty-state">
            When someone mentions you, replies to you or messages you, it shows
            up here.
          </p>
        )}

        {fresh.length > 0 && (
          <section className="activity-section new" aria-label="New">
            <h2 className="activity-section-head eyebrow">
              New
              <span className="activity-section-count">{fresh.length}</span>
              <button
                type="button"
                className="chip activity-mark-all"
                onClick={() => markActivityRead(queryClient, "all")}
              >
                Mark all read
              </button>
            </h2>
            <ul className="activity-list">
              {fresh.map((item) => (
                <li key={item.id}>
                  <ActivityRow item={item} dated />
                </li>
              ))}
            </ul>
          </section>
        )}

        {earlier.length > 0 && (
          <section className="activity-section read" aria-label="Read">
            <h2 className="activity-section-head eyebrow">Read</h2>
            <ul className="activity-list">
              {earlier.map((item, i) => (
                <li key={item.id}>
                  <ActivityRow
                    item={item}
                    day={
                      item.createdAt && startsDay(item, earlier[i - 1])
                        ? dayLabel(timestampDate(item.createdAt))
                        : undefined
                    }
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

        {all.length > 0 && !exhausted && (
          <LoadMoreSentinel onVisible={loadMore} loading={loadingMore} />
        )}
      </div>
    </div>
  );
}

// The end of the list: scrolling it into view asks for the next page.
// A button as well, for a keyboard and for a viewport that never
// scrolls because the list is short.
function LoadMoreSentinel({
  onVisible,
  loading,
}: {
  onVisible: () => void;
  loading: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onVisible();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [onVisible]);
  return (
    <button
      ref={ref}
      type="button"
      className="chip activity-more"
      onClick={onVisible}
      disabled={loading}
    >
      {loading ? "Loading…" : "Load older"}
    </button>
  );
}
