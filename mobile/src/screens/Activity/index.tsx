import { withOlderPages } from "@stoop/core/activity";
import type { ActivityItem } from "@stoop/gen/stoop/chat/v1/activity_pb";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useActivity } from "../../activity/ActivityProvider";
import { hostOf } from "../../api/probe";
import ServerHeader from "../../components/ServerHeader";
import TabNotice from "../../components/TabNotice";
import { usePushOnce } from "../../hooks/usePushOnce";
import type { SavedServer } from "../../servers";
import { type Theme, tokens, useTheme } from "../../theme";
import ActivityRow from "./ActivityRow";
import { type FeedRow, feedRows } from "./rows";
import SectionHead from "./SectionHead";
import { usePlaces } from "./usePlaces";

// The Activity tab: everything that has happened to you on this server,
// as web's inbox has it (web/src/routes/Activity). New holds what is
// unread, newest first, as cards, with Mark all read on its heading;
// Read is the history, flat, the first row of each day carrying the
// day. The first page is the server's feed (src/activity), the one the
// tab's badge counts, kept live there with the older pages loaded as
// the list reaches its end (held there too, so a read stamps them), and
// a pull loads the feed again. Opening a row reads
// it and opens the channel at the message, or its thread at the reply;
// a direct message opens nothing until there is a conversation screen.

export default function Activity({ server }: { server: SavedServer }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(theme);
  const router = useRouter();
  const pushOnce = usePushOnce();
  const { feed, refresh, reload, loadMore, markRead } = useActivity();
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const ready = feed.state === "ready" ? feed : null;
  const token = ready?.token ?? null;
  const all = useMemo(() => (ready ? withOlderPages(ready.data.items, ready.older) : []), [ready]);
  const rows = useMemo(() => feedRows(all), [all]);
  const places = usePlaces(server.origin, token, all);
  const unread = ready ? all.some((item) => !item.readAt) : false;
  const exhausted = ready?.exhausted ?? false;
  const [loadingMore, setLoadingMore] = useState(false);
  const more = useCallback(async () => {
    setLoadingMore(true);
    await loadMore();
    setLoadingMore(false);
  }, [loadMore]);

  const pull = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  const retry = async () => {
    setRetrying(true);
    await refresh();
    setRetrying(false);
  };

  const open = useCallback(
    (item: ActivityItem) => {
      if (!item.spaceId) return;
      // Read on the way; a refusal doesn't hold the channel back.
      if (!item.readAt) markRead([item.id]).catch(() => {});
      const params = { id: server.id, spaceId: item.spaceId, channelId: item.channelId, focus: item.messageId };
      pushOnce(() =>
        router.push(
          item.threadRootId
            ? {
                pathname: "/s/[id]/space/[spaceId]/channel/[channelId]/thread/[rootId]",
                params: { ...params, rootId: item.threadRootId },
              }
            : { pathname: "/s/[id]/space/[spaceId]/channel/[channelId]", params },
        ),
      );
    },
    [markRead, pushOnce, router, server.id],
  );

  const markAll = useCallback(() => {
    markRead("all").catch(() => {});
  }, [markRead]);

  const renderRow = ({ item: row }: { item: FeedRow }) => {
    if (row.kind === "newHead") return <SectionHead title="New" count={row.count} onMarkAll={markAll} />;
    if (row.kind === "readHead") {
      return (
        <View style={unread && styles.afterNew}>
          <SectionHead title="Read" />
        </View>
      );
    }
    return (
      <View style={row.kind === "new" && styles.card}>
        <ActivityRow
          item={row.item}
          unread={row.kind === "new"}
          day={row.kind === "read" ? row.day : undefined}
          last={row.kind === "read" && row.last}
          channelName={places.channelName(row.item)}
          spaceName={places.spaceName(row.item)}
          handle={ready?.reader.username ?? ""}
          origin={server.origin}
          token={token ?? ""}
          onPress={open}
        />
      </View>
    );
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ServerHeader server={server} />
      <Text style={styles.title} accessibilityRole="header">
        Activity
      </Text>
      {(feed.state === "loading" || retrying) && <ActivityIndicator style={styles.center} color={theme.textMuted} />}
      {feed.state === "ended" && (
        <TabNotice
          message={`Your sign-in to ${server.name} has ended. Sign in again to carry on.`}
          action={{
            label: "Sign in again",
            onPress: () => router.replace({ pathname: "/sign-in", params: { server: server.origin } }),
          }}
        />
      )}
      {feed.state === "failed" && !retrying && (
        <TabNotice message={`Couldn't reach ${hostOf(server.origin)}.`} action={{ label: "Try again", onPress: retry }} />
      )}
      {ready && (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.key}
          renderItem={renderRow}
          contentContainerStyle={styles.list}
          onEndReached={exhausted ? undefined : more}
          onEndReachedThreshold={0.5}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pull} tintColor={theme.textMuted} />}
          ListHeaderComponent={
            all.length > 0 && !unread ? <Text style={styles.caughtUp}>You're all caught up.</Text> : undefined
          }
          ListEmptyComponent={
            <Text style={styles.empty}>
              When someone mentions you, replies to you or messages you, it shows up here.
            </Text>
          }
          ListFooterComponent={
            loadingMore ? <ActivityIndicator style={styles.more} color={theme.textMuted} /> : undefined
          }
        />
      )}
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.surface,
    },
    title: {
      marginTop: 12,
      marginBottom: 8,
      marginHorizontal: 20,
      color: theme.text,
      fontSize: tokens.textDisplay,
      lineHeight: tokens.textDisplay * tokens.leadingTight,
      fontWeight: "700",
    },
    center: {
      marginTop: 24,
    },
    list: {
      paddingHorizontal: 12,
      paddingBottom: 16,
    },
    card: {
      marginBottom: 4,
    },
    afterNew: {
      marginTop: 12,
    },
    caughtUp: {
      marginHorizontal: 8,
      marginBottom: 16,
      color: theme.textMuted,
      fontSize: tokens.textUi,
    },
    empty: {
      marginVertical: 24,
      marginHorizontal: 8,
      color: theme.textMuted,
      fontSize: tokens.textBody,
      lineHeight: tokens.textBody * tokens.leadingBody,
    },
    more: {
      marginTop: 12,
    },
  });
}
