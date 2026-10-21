import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { losesChannel, withChannelEvent, withNewestPage } from "@stoop/core/channelTimeline";
import { dayLabel } from "@stoop/core/dates";
import { continues, firstNewMessageId, startsDay } from "@stoop/core/grouping";
import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import type { ServerEvent } from "@stoop/gen/stoop/realtime/v1/realtime_pb";
import { Stack, useIsFocused, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChannelGone, type ChannelView, loadChannel, loadOlder, markRead } from "../../api/messages";
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
// next step.

type State =
  | { state: "loading" }
  | {
      state: "ready";
      token: string;
      view: ChannelView;
      // The read marker as it was on opening, so the "New" line stays put
      // as the marker moves.
      newAfter: string;
      loadingOlder: boolean;
    }
  | { state: "ended" }
  | { state: "gone" }
  | { state: "failed" };

type Item =
  | { kind: "message"; key: string; message: Message; continued: boolean }
  | { kind: "day" | "new"; key: string; label: string };

// What a realtime event does to the screen: a rename retitles it, losing
// the channel ends it, and the rest is the timeline's (core/channelTimeline).
function withEvent(current: State, event: ServerEvent): State {
  if (current.state !== "ready") return current;
  const { view } = current;
  if (losesChannel(event, view.space.id, view.channel.id, view.myUserId)) return { state: "gone" };
  if (event.payload.case === "channelUpdated") {
    if (event.payload.value.id !== view.channel.id) return current;
    const { name, private: closed, topic, postPolicy } = event.payload.value;
    return { ...current, view: { ...view, channel: { ...view.channel, name, private: closed, topic, postPolicy } } };
  }
  const messages = withChannelEvent(view.messages, event, view.channel.id);
  return messages === view.messages ? current : { ...current, view: { ...view, messages } };
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
  const [view, setView] = useState<State>({ state: "loading" });
  const [active, setActive] = useState(AppState.currentState === "active");
  const list = useRef<FlatList<Item>>(null);

  const load = useCallback(async (): Promise<State> => {
    const token = await sessionToken(server.id).catch(() => null);
    if (!token) return { state: "ended" };
    try {
      const loaded = await loadChannel(server.origin, token, spaceId, channelId);
      return { state: "ready", token, view: loaded, newAfter: loaded.channel.lastReadMessageId, loadingOlder: false };
    } catch (err) {
      if (err instanceof ChannelGone) return { state: "gone" };
      if (err instanceof ConnectError && err.code === Code.Unauthenticated) return { state: "ended" };
      if (err instanceof ConnectError && (err.code === Code.NotFound || err.code === Code.PermissionDenied)) {
        return { state: "gone" };
      }
      return { state: "failed" };
    }
  }, [server, spaceId, channelId]);

  // As the space's screen: overlapping loads show only the latest. A
  // load's page was fetched before whatever arrives while the rest of it
  // runs, so events are kept from its start and replayed over its result.
  const latest = useRef(0);
  const missed = useRef<ServerEvent[] | null>(null);
  const settle = useCallback(
    async (merge: (current: State, next: State) => State) => {
      const mine = ++latest.current;
      missed.current = [];
      const next = await load();
      if (mine !== latest.current) return;
      const events = missed.current ?? [];
      missed.current = null;
      setView((current) => events.reduce(withEvent, merge(current, next)));
    },
    [load],
  );

  const open = useCallback(() => settle((_, next) => next), [settle]);

  useEffect(() => {
    open();
    const sub = AppState.addEventListener("change", (state) => setActive(state === "active"));
    return () => {
      latest.current++;
      sub.remove();
    };
  }, [open]);

  // After a reconnect, the newest page in place of the newest end held;
  // the header's facts may have changed too. A reconnect that can't load
  // keeps what is on screen.
  const catchUp = useCallback(
    () =>
      settle((current, next) => {
        if (current.state !== "ready") return next;
        if (next.state === "failed") return current;
        if (next.state !== "ready") return next;
        const merged = withNewestPage(current.view, next.view);
        return { ...current, token: next.token, view: { ...next.view, ...merged } };
      }),
    [settle],
  );

  useServerEvents(server.id, (event) => {
    if (event.payload.case === "ready") {
      if (view.state === "ready") catchUp();
      else if (view.state === "failed") open();
      return;
    }
    missed.current?.push(event);
    if (view.state !== "ready") return;
    if (losesChannel(event, spaceId, channelId, view.view.myUserId)) latest.current++;
    setView((current) => withEvent(current, event));
  });

  // The page above the oldest message held, once at a time. A reconnect
  // that replaced what is held meanwhile leaves the page nowhere to go.
  const older = useCallback(async () => {
    if (view.state !== "ready" || view.loadingOlder || !view.view.hasOlder) return;
    const oldest = view.view.messages[0];
    if (!oldest) return;
    setView((current) => (current.state === "ready" ? { ...current, loadingOlder: true } : current));
    const page = await loadOlder(server.origin, view.token, channelId, oldest.id).catch(() => null);
    setView((current) => {
      if (current.state !== "ready") return current;
      const held = current.view.messages;
      if (!page || held[0]?.id !== oldest.id) return { ...current, loadingOlder: false };
      // Messages that arrived meanwhile are already below; the page goes
      // above whatever is held now.
      const above = page.messages.filter((message) => !held.some((cached) => cached.id === message.id));
      return {
        ...current,
        loadingOlder: false,
        view: { ...current.view, messages: [...above, ...held], hasOlder: page.hasOlder },
      };
    });
  }, [view, server.origin, channelId]);

  // The reader's marker follows the newest message while the channel is
  // on screen with the app open, as on web.
  const newestId = view.state === "ready" ? (view.view.messages.at(-1)?.id ?? "") : "";
  const token = view.state === "ready" ? view.token : "";
  const marked = useRef("");
  useEffect(() => {
    if (!newestId || !token || !focused || !active) return;
    const readTo = view.state === "ready" ? view.view.channel.lastReadMessageId : "";
    if (newestId <= readTo || newestId <= marked.current) return;
    marked.current = newestId;
    markRead(server.origin, token, channelId, newestId).catch(() => {
      if (marked.current === newestId) marked.current = "";
    });
  }, [newestId, token, focused, active, server.origin, channelId, view]);

  const items = useMemo(() => {
    if (view.state !== "ready") return [];
    const { messages, myUserId } = view.view;
    const firstNew = firstNewMessageId(messages, view.newAfter, myUserId);
    const built: Item[] = [];
    messages.forEach((message, index) => {
      const previous = messages[index - 1];
      const day = message.createdAt && startsDay(message, previous) ? dayLabel(timestampDate(message.createdAt)) : null;
      if (message.id === firstNew) {
        // On a day boundary the two share one line, in the "New" colour.
        built.push({ kind: "new", key: `new-${message.id}`, label: day ? `${day} · New` : "New" });
      } else if (day) {
        built.push({ kind: "day", key: `day-${message.id}`, label: day });
      }
      built.push({
        kind: "message",
        key: message.id,
        message,
        continued: continues(message, previous, firstNew, false),
      });
    });
    // Newest first, for a list drawn from the bottom up.
    return built.reverse();
  }, [view]);

  // Opening lands on the "New" line, once.
  const landed = useRef(false);
  const newIndex = items.findIndex((item) => item.kind === "new");
  useEffect(() => {
    if (landed.current || items.length === 0) return;
    landed.current = true;
    if (newIndex > 0) list.current?.scrollToIndex({ index: newIndex, viewPosition: 0.5, animated: false });
  }, [items.length, newIndex]);

  const retry = async () => {
    setView({ state: "loading" });
    await open();
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

  const { space, channel, memberCount, myUserId, hasOlder } = view.view;

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
              token={view.token}
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
              {view.view.messages.length === 0 ? "No messages yet. " : ""}This is the beginning of #{channel.name}.
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
