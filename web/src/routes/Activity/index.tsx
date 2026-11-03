import { timestampDate, timestampNow } from "@bufbuild/protobuf/wkt";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { markActivityRead } from "../../api/activity";
import { chatClient } from "../../api/clients";
import { useActivity } from "../../api/queries";
import { MenuButton } from "../../components/MenuButton";
import {
  type ActivityData,
  needsOlderPageForNew,
  startsDay,
  withOlderPages,
  withoutRefreshed,
} from "../../core/activity";
import { dayLabel } from "../../core/dates";
import type { ActivityItem } from "../../gen/stoop/chat/v1/activity_pb";
import { ActivityRow } from "./ActivityRow";

// The activity inbox: everything that has happened to you, in two
// sections. New holds what is unread, newest first, with "Mark activity
// read" on its heading, which reads the feed and nothing else (the
// badges on channels and spaces clear when those are read); Read is the
// read history, the first row of each day carrying the day. The first
// page comes from the shared cache (the one the activity pill's dot
// reads), and older pages load as the list is scrolled to its end, and
// on their own while the server counts more unread than New holds, up
// to a bound (core needsOlderPageForNew). A row that is read moves from
// one section to the other because the cache stamps it, not because
// the page moves it.
export function ActivityPage() {
  const { data, isFetching } = useActivity();
  const [older, setOlder] = useState<ActivityItem[]>([]);
  const [exhausted, setExhausted] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // One page in flight, whichever asked for it; the state above is for
  // drawing and lags a render behind.
  const inFlight = useRef(false);
  // Pages fetched for New's sake on this visit, against the bound.
  const autoPages = useRef(0);
  const queryClient = useQueryClient();

  const recent = data?.items;
  const all = useMemo(
    () => withOlderPages(recent ?? [], older),
    [recent, older],
  );
  const fresh = all.filter((item) => !item.readAt);
  const earlier = all.filter((item) => item.readAt);

  const loadOlderPage = useCallback(
    async (forNew: boolean) => {
      const last = all[all.length - 1];
      if (!last || inFlight.current || exhausted) return;
      inFlight.current = true;
      if (forNew) autoPages.current++;
      setLoadingMore(true);
      try {
        const res = await chatClient.listActivity({ beforeId: last.id });
        setOlder((o) => [...o, ...res.items]);
        if (res.items.length === 0) setExhausted(true);
      } finally {
        inFlight.current = false;
        setLoadingMore(false);
      }
    },
    [all, exhausted],
  );
  const loadMore = useCallback(() => loadOlderPage(false), [loadOlderPage]);

  // New holds everything the server counts: once the first page is the
  // server's (not a cached copy about to be replaced), and after each
  // older page lands, the next is asked for while the rule says so. A
  // page that fails is left to the sentinel, which asks again on the
  // next scroll.
  useEffect(() => {
    if (!data || isFetching) return;
    if (
      needsOlderPageForNew(data.unreadCount, all, exhausted, autoPages.current)
    ) {
      loadOlderPage(true).catch(() => {});
    }
  }, [data, isFetching, all, exhausted, loadOlderPage]);

  // The server reads everything, older pages included, but only the
  // first page is in the cache it stamps, so the page stamps the rest,
  // less an entry the first page refreshed: that row is gone on the
  // server, and stamped it would show its conversation twice in Read.
  // The first page is read from the cache once the server has answered,
  // since an entry can be refreshed while the request is in flight.
  const markAllRead = async () => {
    await markActivityRead(queryClient, "all");
    const readAt = timestampNow();
    const first =
      queryClient.getQueryData<ActivityData>(["activity"])?.items ?? [];
    setOlder((o) =>
      withoutRefreshed(first, o).map((item) =>
        item.readAt ? item : { ...item, readAt },
      ),
    );
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
                onClick={markAllRead}
              >
                Mark activity read
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
