import { channelItems } from "@stoop/core/channelLog";
import { type GroupedRow, groupedRows } from "@stoop/core/grouping";
import { Stack, useIsFocused, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { markRead } from "../../api/messages";
import { hostOf } from "../../api/probe";
import type { SavedServer } from "../../servers";
import { type Theme, tokens, useTheme } from "../../theme";
import ChannelTitle from "./ChannelTitle";
import Divider from "./Divider";
import MessageRow from "./MessageRow";
import { useChannelLog } from "./useChannelLog";

// A channel, pushed over its space: its messages newest at the bottom,
// older pages loading as the reader scrolls up, and the realtime socket
// adding, changing and removing messages as they happen. It opens at the
// "New" line when there is one, and keeps the reader's marker at the
// newest message while it is on screen. Reading only: writing is the
// next step. What is held and what each answer and event does to it is
// the channel log's (core/channelLog, through useChannelLog); this screen
// marks read and draws.

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
  const { state, older, retry } = useChannelLog(server, spaceId, channelId);
  const { log, header, outcome, token, newAfter, loadingOlder } = state;
  const [active, setActive] = useState(AppState.currentState === "active");
  const list = useRef<FlatList<GroupedRow>>(null);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (appState) => setActive(appState === "active"));
    return () => sub.remove();
  }, []);

  // The channel's shown rows, oldest first; the same array while nothing
  // shown changed.
  const messages = channelItems(log);

  // The reader's marker follows the newest message while the channel is
  // on screen with the app open, as on web.
  const newestId = messages.at(-1)?.id ?? "";
  const marked = useRef("");
  useEffect(() => {
    if (!newestId || !token || !focused || !active || !header) return;
    const readTo = header.channel.lastReadMessageId;
    if (newestId <= readTo || newestId <= marked.current) return;
    marked.current = newestId;
    markRead(server.origin, token, channelId, newestId).catch(() => {
      if (marked.current === newestId) marked.current = "";
    });
  }, [newestId, token, focused, active, server.origin, channelId, header]);

  // Newest first, for a list drawn from the bottom up.
  const items = useMemo(
    () => (header ? groupedRows(messages, newAfter, header.myUserId).reverse() : []),
    [messages, newAfter, header],
  );

  // Opening lands on the "New" line, once.
  const landed = useRef(false);
  const newIndex = items.findIndex((item) => item.kind === "new");
  useEffect(() => {
    if (landed.current || items.length === 0) return;
    landed.current = true;
    if (newIndex > 0) list.current?.scrollToIndex({ index: newIndex, viewPosition: 0.5, animated: false });
  }, [items.length, newIndex]);

  if (outcome) {
    return (
      <View style={styles.screen}>
        <View style={styles.notice} accessibilityRole="alert">
          {outcome === "ended" && (
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
          {outcome === "gone" && <Text style={styles.body}>This channel isn't available any more.</Text>}
          {outcome === "failed" && (
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
  if (!header) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator style={styles.center} color={theme.textMuted} />
      </View>
    );
  }

  const { space, channel, memberCount, myUserId } = header;
  const { hasOlder } = log.channel;

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
          loadingOlder ? (
            <ActivityIndicator style={styles.edge} color={theme.textMuted} />
          ) : !hasOlder ? (
            <Text style={styles.beginning}>
              {messages.length === 0 ? "No messages yet. " : ""}This is the beginning of #{channel.name}.
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
