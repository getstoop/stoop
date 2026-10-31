import { timestampNow } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  type ActivityData,
  type ReadPlace,
  readMayClearActivity,
  withActivityItem,
  withActivityRead,
} from "@stoop/core/activity";
import type { ActivityItem } from "@stoop/gen/stoop/chat/v1/activity_pb";
import type { ServerEvent } from "@stoop/gen/stoop/realtime/v1/realtime_pb";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  loadActivity,
  loadOlderActivity,
  loadReader,
  type Reader,
  readActivity,
  readChannelActivity,
} from "../api/activity";
import { sessionToken } from "../api/servers";
import { useServerEvents } from "../realtime/RealtimeProvider";
import type { SavedServer } from "../servers";
import { deletionMayClearActivity, olderAfterLoad, olderAfterRead } from "./feed";

// One server's activity feed, as web keeps it in its query cache
// (web/src/api/activity.ts): the first page of ListActivity and the
// server's unread count, held for the Activity tab, its badge, and the
// channel screen that reads what it shows, with the older pages the tab
// has scrolled to beside it, so a read stamps them too. Loaded on
// mounting and on the socket's Ready (a reconnect, which coming back to
// the app brings; a few seconds without one load anyway); kept current
// by ActivityItemCreated; loaded again when a read marker moved where it
// could have read something held (core readMayClearActivity), a message
// that may have an item was deleted (the server deletes its items and
// says nothing of them), or a mute or a deleted channel made what is
// held stale. Reading through markRead or readChannel stamps the items
// here as the server answers, since MarkActivityRead sends no event.

export type Feed =
  | { state: "loading" }
  | {
      state: "ready";
      token: string;
      data: ActivityData;
      reader: Reader;
      // The pages past the first the tab has loaded, oldest last, and
      // whether the last of them came back empty.
      older: ActivityItem[];
      exhausted: boolean;
    }
  // Only the server saying the session is over counts as signed out; it
  // stays so until this server's stack mounts again.
  | { state: "ended" }
  // Never loaded; a later load that fails keeps what was held.
  | { state: "failed" };

type Store = {
  feed: Feed;
  // Loads the first page again; resolves once it has landed.
  refresh: () => Promise<void>;
  // A pull: the first page again, with the older pages dropped.
  reload: () => Promise<void>;
  // The page older than everything held; nothing past the oldest.
  loadMore: () => Promise<void>;
  // Reads items, or everything. Throws when the server refuses.
  markRead: (ids: string[] | "all") => Promise<void>;
  // Reads what is unread in a channel itself (not its threads), for the
  // channel on screen. Says how many it read.
  readChannel: (channelId: string) => Promise<number>;
};

const ActivityContext = createContext<Store | null>(null);

// How long after coming back to the app the socket's Ready may take
// before the feed is loaded without it.
const READY_GRACE_MS = 3000;

const unauthenticated = (err: unknown) => err instanceof ConnectError && err.code === Code.Unauthenticated;

export default function ActivityProvider({ server, children }: { server: SavedServer; children: ReactNode }) {
  const [feed, setFeed] = useState<Feed>({ state: "loading" });
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const reader = useRef<Reader | null>(null);
  // The load in flight, whether another was asked for while it ran, and
  // the items delivered meanwhile, laid over what it brings back so an
  // item created after the server answered isn't lost.
  const loading = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const arrived = useRef<ActivityItem[] | null>(null);
  // Counts reads stamped: a load answered from before one is dropped (and
  // goes again) rather than undoing it.
  const reads = useRef(0);
  // Counts pulls: an older page asked for before one lands nowhere.
  const pulls = useRef(0);
  const paging = useRef(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const set = useCallback((next: Feed | ((held: Feed) => Feed)) => {
    if (alive.current) setFeed(next);
  }, []);
  // The server said the session is over: nothing more to load.
  const end = useCallback(() => set({ state: "ended" }), [set]);

  const token = useCallback(async () => {
    const held = feedRef.current;
    return held.state === "ready" ? held.token : await sessionToken(server.id).catch(() => null);
  }, [server.id]);

  const loadOnce = useCallback(async () => {
    arrived.current = [];
    const readsBefore = reads.current;
    const session = await sessionToken(server.id).catch(() => null);
    if (!session) {
      end();
      return;
    }
    try {
      const [first, me] = await Promise.all([
        loadActivity(server.origin, session),
        reader.current ?? loadReader(server.origin, session),
      ]);
      reader.current = me;
      if (reads.current !== readsBefore) {
        again.current = true;
        return;
      }
      let data = first;
      for (const item of arrived.current ?? []) data = withActivityItem(data, item);
      const readAt = timestampNow();
      set((held) =>
        held.state === "ended"
          ? held
          : held.state === "ready"
            ? { ...held, token: session, data, reader: me, older: olderAfterLoad(held.older, data, readAt) }
            : { state: "ready", token: session, data, reader: me, older: [], exhausted: false },
      );
    } catch (err) {
      if (unauthenticated(err)) end();
      else set((held) => (held.state === "ready" || held.state === "ended" ? held : { state: "failed" }));
    } finally {
      arrived.current = null;
    }
  }, [server, set, end]);

  // One load at a time: asked again while one runs, it goes once more
  // when that lands, and both callers wait for the last.
  const refresh = useCallback(() => {
    if (loading.current) {
      again.current = true;
      return loading.current;
    }
    const run = async () => {
      do {
        again.current = false;
        await loadOnce();
      } while (again.current && alive.current);
      loading.current = null;
    };
    loading.current = run();
    return loading.current;
  }, [loadOnce]);

  const reload = useCallback(() => {
    pulls.current++;
    paging.current = false;
    set((held) => (held.state === "ready" ? { ...held, older: [], exhausted: false } : held));
    return refresh();
  }, [refresh, set]);

  const loadMore = useCallback(async () => {
    const held = feedRef.current;
    if (held.state !== "ready" || held.exhausted || paging.current) return;
    const last = held.older.at(-1) ?? held.data.items.at(-1);
    if (!last) return;
    const pull = pulls.current;
    paging.current = true;
    try {
      const page = await loadOlderActivity(server.origin, held.token, last.id);
      if (pull !== pulls.current) return;
      set((now) =>
        now.state === "ready"
          ? { ...now, older: [...now.older, ...page], exhausted: now.exhausted || page.length === 0 }
          : now,
      );
    } catch (err) {
      // Otherwise reaching the end again asks again.
      if (unauthenticated(err)) end();
    } finally {
      if (pull === pulls.current) paging.current = false;
    }
  }, [server.origin, set, end]);

  // What the server answered for a read, stamped on the items held, the
  // older pages too.
  const stampRead = useCallback(
    (ids: string[] | "all", unreadCount: number) => {
      reads.current++;
      const readAt = timestampNow();
      set((held) =>
        held.state === "ready"
          ? {
              ...held,
              data: withActivityRead(held.data, ids, unreadCount, readAt),
              older: olderAfterRead(held.older, ids, readAt),
            }
          : held,
      );
    },
    [set],
  );

  const markRead = useCallback(
    async (ids: string[] | "all") => {
      const session = await token();
      if (!session) throw new Error("Signed out.");
      try {
        stampRead(ids, await readActivity(server.origin, session, ids));
      } catch (err) {
        if (unauthenticated(err)) end();
        throw err;
      }
    },
    [server.origin, token, stampRead, end],
  );

  const readChannel = useCallback(
    async (channelId: string) => {
      const session = await token();
      if (!session) return 0;
      try {
        const { ids, unreadCount } = await readChannelActivity(server.origin, session, channelId);
        if (ids.length > 0) stampRead(ids, unreadCount);
        return ids.length;
      } catch (err) {
        if (unauthenticated(err)) end();
        throw err;
      }
    },
    [server.origin, token, stampRead, end],
  );

  // Loaded on mounting. Coming back from the background reopens the
  // socket, whose Ready loads it; should none come soon, it loads anyway.
  // "inactive" is a moment between (the app switcher, a system sheet),
  // after which nothing was missed.
  const readyDue = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    refresh();
    let last = AppState.currentState;
    const sub = AppState.addEventListener("change", (next) => {
      if (last === "background" && next === "active") {
        if (readyDue.current) clearTimeout(readyDue.current);
        readyDue.current = setTimeout(() => {
          readyDue.current = null;
          refresh();
        }, READY_GRACE_MS);
      }
      last = next;
    });
    return () => {
      sub.remove();
      if (readyDue.current) clearTimeout(readyDue.current);
    };
  }, [refresh]);

  // A read marker that moved, on this phone or another device, read the
  // activity it passed on the server; fetched again when that could be
  // something held.
  const afterRead = useCallback(
    (place: ReadPlace) => {
      const held = feedRef.current;
      if (held.state === "ready" && readMayClearActivity(held.data, place)) refresh();
    },
    [refresh],
  );

  useServerEvents(server.id, (event: ServerEvent) => {
    const payload = event.payload;
    switch (payload.case) {
      case "ready":
        if (readyDue.current) {
          clearTimeout(readyDue.current);
          readyDue.current = null;
        }
        refresh();
        break;
      case "activityItemCreated": {
        const item = payload.value.item;
        if (!item) break;
        arrived.current?.push(item);
        set((held) => (held.state === "ready" ? { ...held, data: withActivityItem(held.data, item) } : held));
        break;
      }
      case "channelRead":
        afterRead({ channelId: payload.value.channelId });
        break;
      case "threadRead":
        afterRead({ threadRootId: payload.value.rootMessageId });
        break;
      case "messageCreated": {
        // Sending moves the sender's marker without a ChannelRead; a reply
        // only in its thread moves no channel marker, as web's ws.ts.
        const m = payload.value;
        if (m.threadRootId && !m.inChannel) break;
        if (m.author?.id && m.author.id === reader.current?.id) afterRead({ channelId: m.channelId });
        break;
      }
      case "messageDeleted": {
        const { messageId } = payload.value;
        const held = feedRef.current;
        if (held.state !== "ready" || !deletionMayClearActivity(held.data, held.older, messageId)) break;
        set((now) =>
          now.state === "ready" ? { ...now, older: now.older.filter((item) => item.messageId !== messageId) } : now,
        );
        refresh();
        break;
      }
      // The mute stamps on the items held are stale, or a channel's
      // items, or a space's, went with it.
      case "channelMuted":
      case "spaceMuted":
      case "channelDeleted":
      case "spaceDeleted":
        refresh();
        break;
    }
  });

  const store = useMemo(
    () => ({ feed, refresh, reload, loadMore, markRead, readChannel }),
    [feed, refresh, reload, loadMore, markRead, readChannel],
  );
  return <ActivityContext.Provider value={store}>{children}</ActivityContext.Provider>;
}

// The current server's activity feed and what reads it.
export function useActivity(): Store {
  const store = useContext(ActivityContext);
  if (!store) throw new Error("useActivity needs an ActivityProvider above it");
  return store;
}
