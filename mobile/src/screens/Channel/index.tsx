import { Code, ConnectError } from "@connectrpc/connect";
import type { ChannelHeader } from "@stoop/core/timelineEvents";
import { type TimelineItem, timelineItems } from "@stoop/core/timelineItems";
import { heldBack, initialTimeline, olderBefore, reconnectLoad, timelineReducer } from "@stoop/core/timelineState";
import { Stack, useIsFocused, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ActivityIndicator, AppState, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChannelGone, loadChannel, loadOlder, markRead } from "../../api/messages";
import { hostOf } from "../../api/probe";
import { sessionToken } from "../../api/servers";
import { useServerEvents } from "../../realtime/RealtimeProvider";
import type { SavedServer } from "../../servers";
import { type Theme, tokens, useTheme } from "../../theme";
import ChannelTitle from "./ChannelTitle";
import Divider from "./Divider";
import MessageRow from "./MessageRow";

// A channel, pushed over its space: its messages newest at the bottom,
// older pages loading as the reader scrolls up, and the realtime socket
// adding, changing and removing messages as they happen. It opens at the
// "New" line when there is one, and keeps the reader's marker at the
// newest message while it is on screen. Reading only: writing is the
// next step. What each answer and event does to what is shown is the
// shared timeline's (core/timelineState, core/timelineEvents); this
// screen fetches, marks read and draws.

// Why a load failed, as the timeline shows it.
function outcomeOf(err: unknown): "ended" | "gone" | "failed" {
  if (err instanceof ChannelGone) return "gone";
  if (err instanceof ConnectError && err.code === Code.Unauthenticated) return "ended";
  if (err instanceof ConnectError && (err.code === Code.NotFound || err.code === Code.PermissionDenied)) return "gone";
  return "failed";
}

export default function Channel({
  server,
  spaceId,
  channelId,
}: {
  server: SavedServer;
  spaceId: string;
  channelId: string;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const router = useRouter();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const [timeline, dispatch] = useReducer(timelineReducer<ChannelHeader>, initialTimeline);
  const view = timeline.shown;
  const [token, setToken] = useState("");
  const [active, setActive] = useState(AppState.currentState === "active");
  const list = useRef<FlatList<TimelineItem>>(null);
  const requests = useRef(0);

  // Opens the channel, or after a reconnect loads it again down to back,
  // the oldest message held.
  const load = useCallback(
    async (kind: "open" | "catchUp", back = "") => {
      const id = ++requests.current;
      dispatch({ type: "started", id, kind });
      const signedIn = await sessionToken(server.id).catch(() => null);
      if (!signedIn) {
        dispatch({ type: "failed", id, outcome: "ended" });
        return;
      }
      try {
        const { header, page } = await loadChannel(server.origin, signedIn, spaceId, channelId, back);
        setToken(signedIn);
        dispatch({ type: "loaded", id, channelId, page, header, newAfter: header.channel.lastReadMessageId });
      } catch (err) {
        dispatch({ type: "failed", id, outcome: outcomeOf(err) });
      }
    },
    [server, spaceId, channelId],
  );

  useEffect(() => {
    load("open");
    const sub = AppState.addEventListener("change", (state) => setActive(state === "active"));
    return () => sub.remove();
  }, [load]);

  useServerEvents(server.id, (event) => {
    if (event.payload.case !== "ready") {
      dispatch({ type: "event", event });
      return;
    }
    const kind = reconnectLoad(timeline);
    if (kind) load(kind, heldBack(timeline));
  });

  // The page above the oldest message held, once at a time.
  const older = useCallback(async () => {
    const before = olderBefore(timeline);
    if (!before) return;
    const id = ++requests.current;
    dispatch({ type: "started", id, kind: "older" });
    try {
      dispatch({ type: "paged", id, page: await loadOlder(server.origin, token, channelId, before) });
    } catch {
      dispatch({ type: "failed", id, outcome: "failed" });
    }
  }, [timeline, token, server.origin, channelId]);

  // The reader's marker follows the newest message while the channel is
  // on screen with the app open, as on web.
  const newestId = view.state === "ready" ? (view.page.messages.at(-1)?.id ?? "") : "";
  const marked = useRef("");
  useEffect(() => {
    if (!newestId || !token || !focused || !active) return;
    const readTo = view.state === "ready" ? view.header.channel.lastReadMessageId : "";
    if (newestId <= readTo || newestId <= marked.current) return;
    marked.current = newestId;
    markRead(server.origin, token, channelId, newestId).catch(() => {
      if (marked.current === newestId) marked.current = "";
    });
  }, [newestId, token, focused, active, server.origin, channelId, view]);

  // Newest first, for a list drawn from the bottom up.
  const items = useMemo(
    () =>
      view.state === "ready" ? timelineItems(view.page.messages, view.newAfter, view.header.myUserId).reverse() : [],
    [view],
  );

  // Opening lands on the "New" line, once.
  const landed = useRef(false);
  const newIndex = items.findIndex((item) => item.kind === "new");
  useEffect(() => {
    if (landed.current || items.length === 0) return;
    landed.current = true;
    if (newIndex > 0) list.current?.scrollToIndex({ index: newIndex, viewPosition: 0.5, animated: false });
  }, [items.length, newIndex]);

  const retry = () => {
    dispatch({ type: "retried" });
    load("open");
  };

  if (view.state === "loading") {
    return (
      <View style={styles.screen}>
        <ActivityIndicator style={styles.center} color={theme.textMuted} />
      </View>
    );
  }
  if (view.state !== "ready") {
    return (
      <View style={styles.screen}>
        <View style={styles.notice} accessibilityRole="alert">
          {view.state === "ended" && (
            <>
              <Text style={styles.body}>Your sign-in to {server.name} has ended. Sign in again to carry on.</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.replace({ pathname: "/sign-in", params: { server: server.origin } })}
                style={({ pressed }) => [styles.button, pressed && styles.pressed]}
              >
                <Text style={styles.buttonLabel}>Sign in again</Text>
              </Pressable>
            </>
          )}
          {view.state === "gone" && <Text style={styles.body}>This channel isn't available any more.</Text>}
          {view.state === "failed" && (
            <>
              <Text style={styles.body}>Couldn't reach {hostOf(server.origin)}.</Text>
              <Pressable
                accessibilityRole="button"
                onPress={retry}
                style={({ pressed }) => [styles.button, pressed && styles.pressed]}
              >
                <Text style={styles.buttonLabel}>Try again</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    );
  }

  const { space, channel, memberCount, myUserId } = view.header;
  const { hasOlder } = view.page;

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerTitle: () => <ChannelTitle channel={channel} spaceName={space.name} memberCount={memberCount} />,
        }}
      />
      <FlatList
        ref={list}
        inverted
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) =>
          item.kind === "message" ? (
            <MessageRow
              message={item.message}
              continued={item.continued}
              myUserId={myUserId}
              origin={server.origin}
              token={token}
            />
          ) : (
            <Divider label={item.label} fresh={item.kind === "new"} />
          )
        }
        onEndReached={older}
        onEndReachedThreshold={0.5}
        onScrollToIndexFailed={({ index }) => {
          // Rows not measured yet: get near, then try again once drawn.
          list.current?.scrollToOffset({ offset: index * 60, animated: false });
          setTimeout(() => list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false }), 100);
        }}
        // Drawn upside down, so the top padding is the bottom edge: clear of
        // the home indicator until the composer sits there.
        contentContainerStyle={[styles.content, { paddingTop: 12 + insets.bottom }]}
        ListFooterComponent={
          view.loadingOlder ? (
            <ActivityIndicator style={styles.edge} color={theme.textMuted} />
          ) : !hasOlder ? (
            <Text style={styles.beginning}>
              {view.page.messages.length === 0 ? "No messages yet. " : ""}This is the beginning of #{channel.name}.
            </Text>
          ) : undefined
        }
      />
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
    beginning: {
      marginHorizontal: 16,
      marginVertical: 16,
      color: theme.textMuted,
      fontSize: tokens.textUi,
    },
    notice: {
      gap: 12,
      marginTop: 8,
      paddingHorizontal: 20,
    },
    body: {
      color: theme.text,
      fontSize: tokens.textBody,
      lineHeight: tokens.textBody * tokens.leadingBody,
    },
    button: {
      height: 50,
      borderRadius: tokens.radiusMd,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.accent,
    },
    pressed: {
      opacity: 0.85,
    },
    buttonLabel: {
      color: theme.onAccent,
      fontSize: tokens.textBody,
      fontWeight: "600",
    },
  });
}
