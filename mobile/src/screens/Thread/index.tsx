import { isShown, threadItems } from "@stoop/core/channelLog";
import { firstUnreadReplyId, type GroupedRow, threadRows } from "@stoop/core/grouping";
import { Stack, useIsFocused, useRouter } from "expo-router";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, FlatList, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { hostOf } from "../../api/probe";
import type { SavedServer } from "../../servers";
import { type Theme, tokens, useTheme } from "../../theme";
import { olderFits } from "../Channel/channelEngine";
import Divider from "../Channel/Divider";
import MessageRow from "../Channel/MessageRow";
import Unavailable from "../Channel/Unavailable";
import { useChannelLog } from "../Channel/useChannelLog";
import ThreadTitle from "./ThreadTitle";

// A thread, pushed over its channel: the root at the top, ruled off, how
// many replies it has, and the replies under it, newest at the bottom,
// older ones loading as the reader scrolls up, the root shown once
// nothing older is left. It shares the channel's log (useChannelLog with
// the root's id), so a reply, an edit or a deletion of a reply or of the
// root lands here as it does in the channel; a root deleted while
// replies live stays as the channel's placeholder. It opens at the "New"
// line above the replies the reader hadn't read (the root's unread
// count, as the server gave it when the thread opened) and marks the
// thread read while it is on screen with the app open, again for each
// new reply. Replying, and the menu on a reply, are the next step's.

// How long after a failed read it is asked for again.
const READ_RETRY_MS = 5000;

export default function Thread({
  server,
  spaceId,
  channelId,
  rootId,
}: {
  server: SavedServer;
  spaceId: string;
  channelId: string;
  rootId: string;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const router = useRouter();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { state, engine } = useChannelLog(server, spaceId, channelId, rootId);
  const { log, header, outcome, token, threads } = state;
  const thread = threads[rootId];
  const view = log.threads[rootId];
  const [active, setActive] = useState(AppState.currentState === "active");
  const list = useRef<FlatList<GroupedRow>>(null);
  const landed = useRef(false);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (appState) => setActive(appState === "active"));
    return () => sub.remove();
  }, []);

  const held = log.rows.get(rootId);
  const root = held && isShown(held) ? held : undefined;
  const items = threadItems(log, rootId);
  const replies = useMemo(() => (root ? items.slice(1) : items), [root, items]);
  const opened = !!view && view.generation > 0;

  // Where the "New" line goes, decided once, when the replies first show:
  // the read that follows clears the count it is worked out from.
  const [firstNew, setFirstNew] = useState<string | undefined | null>(null);
  const decided = firstNew !== null;
  if (!decided && opened && root && header) {
    setFirstNew(firstUnreadReplyId(replies, root.thread?.unreadCount ?? 0, header.myUserId));
  }

  // Read while on screen, again for each new reply, and again whenever
  // the count comes back above nothing (a page read on the server before
  // the read landed after it), so the read wins. A read that fails is
  // asked for again after a moment, or on the next change.
  const replyCount = root?.thread?.replyCount ?? 0;
  const unread = root?.thread?.unreadCount ?? 0;
  const readAt = useRef(-1);
  const [retries, setRetries] = useState(0);
  useEffect(() => {
    if (!decided || replyCount === 0 || !focused || !active) return;
    if (readAt.current === replyCount && unread === 0) return;
    readAt.current = replyCount;
    let left = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    engine.readThread(rootId).catch(() => {
      readAt.current = -1;
      if (!left) timer = setTimeout(() => setRetries((count) => count + 1), READ_RETRY_MS);
    });
    return () => {
      left = true;
      clearTimeout(timer);
    };
  }, [decided, replyCount, unread, focused, active, engine, rootId, retries]);

  // Newest first, for a list drawn from the bottom up.
  const rows = useMemo(
    () => (decided ? threadRows(replies, firstNew ?? undefined).reverse() : []),
    [decided, replies, firstNew],
  );

  // Opening lands on the "New" line, once.
  const newIndex = rows.findIndex((row) => row.kind === "new");
  useEffect(() => {
    if (landed.current || rows.length === 0) return;
    landed.current = true;
    if (newIndex > 0) list.current?.scrollToIndex({ index: newIndex, viewPosition: 0.5, animated: false });
  }, [rows.length, newIndex]);

  // The header in every state, the channel once it is known.
  const title = (
    <Stack.Screen
      options={{ headerTitle: () => <ThreadTitle channel={header?.channel} spaceName={header?.space.name ?? ""} /> }}
    />
  );
  if (outcome === "ended") {
    return (
      <Screen title={title}>
        <Unavailable
          message={`Your sign-in to ${server.name} has ended. Sign in again to carry on.`}
          action={{
            label: "Sign in again",
            onPress: () => router.replace({ pathname: "/sign-in", params: { server: server.origin } }),
          }}
        />
      </Screen>
    );
  }
  if (outcome === "gone") {
    return (
      <Screen title={title}>
        <Unavailable message="This channel isn't available any more." />
      </Screen>
    );
  }
  if (thread?.outcome === "gone" || (held && !root)) {
    return (
      <Screen title={title}>
        <Unavailable message="This thread isn't available any more." />
      </Screen>
    );
  }
  const failed = outcome === "failed" || thread?.outcome === "failed";
  if (failed) {
    return (
      <Screen title={title}>
        <Unavailable
          message={`Couldn't reach ${hostOf(server.origin)}.`}
          action={{
            label: "Try again",
            onPress: () => {
              if (outcome === "failed") engine.retry();
              engine.retryThread(rootId);
            },
          }}
        />
      </Screen>
    );
  }
  if (!header || !decided || !root) {
    return (
      <Screen title={title}>
        <ActivityIndicator style={styles.center} color={theme.textMuted} />
      </Screen>
    );
  }

  const { myUserId } = header;
  // The root heads the list once nothing older is left to load, or none
  // fits.
  const atTop = !view?.hasOlder || !olderFits(log, rootId);

  return (
    <Screen title={title}>
      <FlatList
        ref={list}
        inverted
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={({ item }) =>
          item.kind === "message" ? (
            <MessageRow
              message={item.message}
              continued={item.continued}
              myUserId={myUserId}
              origin={server.origin}
              token={token}
              withDay
            />
          ) : (
            <Divider label={item.label} fresh={item.kind === "new"} />
          )
        }
        onEndReached={() => engine.olderReplies(rootId)}
        onEndReachedThreshold={0.5}
        onScrollToIndexFailed={({ index }) => {
          // Rows not measured yet: get near, then try again once drawn.
          list.current?.scrollToOffset({ offset: index * 60, animated: false });
          setTimeout(() => list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false }), 100);
        }}
        // Drawn upside down, so the top padding is the bottom edge.
        contentContainerStyle={[styles.content, { paddingTop: 12 + insets.bottom }]}
        maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 80 }}
        ListFooterComponent={
          thread?.loadingOlder ? (
            <ActivityIndicator style={styles.edge} color={theme.textMuted} />
          ) : atTop ? (
            <View>
              <View style={styles.root}>
                <MessageRow
                  message={root}
                  continued={false}
                  myUserId={myUserId}
                  origin={server.origin}
                  token={token}
                  withDay
                />
              </View>
              <View style={styles.rule} />
              <Text style={styles.count}>
                {replyCount === 0 ? "No replies yet" : `${replyCount} ${replyCount === 1 ? "reply" : "replies"}`}
              </Text>
            </View>
          ) : undefined
        }
      />
    </Screen>
  );
}

// The screen's surface under its header.
function Screen({ title, children }: { title: ReactNode; children: ReactNode }) {
  const styles = makeStyles(useTheme());
  return (
    <View style={styles.screen}>
      {title}
      {children}
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.surface,
    },
    content: {
      paddingVertical: 12,
    },
    center: {
      marginTop: 24,
    },
    edge: {
      marginVertical: 16,
    },
    root: {
      paddingBottom: 12,
    },
    rule: {
      marginHorizontal: 16,
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.border,
    },
    count: {
      marginHorizontal: 16,
      marginTop: 12,
      marginBottom: 4,
      color: theme.textMuted,
      fontSize: tokens.textSm,
      fontWeight: "600",
    },
  });
}
