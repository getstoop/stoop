import { channelItems } from "@stoop/core/channelLog";
import { type GroupedRow, groupedRows } from "@stoop/core/grouping";
import { canDeleteAnyMessage } from "@stoop/core/permissions";
import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import * as Haptics from "expo-haptics";
import { Stack, useIsFocused, useRouter } from "expo-router";
import { type ComponentRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { errorText } from "../../api/errors";
import { markRead } from "../../api/messages";
import { hostOf } from "../../api/probe";
import { useKeyboardHeight } from "../../hooks/useKeyboardHeight";
import type { SavedServer } from "../../servers";
import { type Theme, tokens, useTheme } from "../../theme";
import ChannelTitle from "./ChannelTitle";
import Composer, { GAP, PILL } from "./Composer";
import Divider from "./Divider";
import MessageMenu from "./MessageMenu";
import MessageRow from "./MessageRow";
import { olderFits, useChannelLog } from "./useChannelLog";

// A channel, pushed over its space: its messages newest at the bottom,
// older pages loading as the reader scrolls up, and the realtime socket
// adding, changing and removing messages as they happen. It opens at the
// "New" line when there is one, and keeps the reader's marker at the
// newest message while it is on screen. The composer floats over the
// bottom of the list and rides up with the keyboard; what it sends
// comes back as a row the same way an event does. A long press on a
// message opens its menu over the channel (MessageMenu); a reaction or a
// delete from it goes through useChannelLog, and one the server refuses
// is said in a line over the composer for a moment. What is held and
// what each answer and event does to it is the channel log's
// (core/channelLog, under core/channelScreen, through useChannelLog);
// this screen marks read and draws.

// How long a refusal's line stays.
const NOTICE_MS = 4000;

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
  const keyboard = useKeyboardHeight();
  const { state, older, retry, send, react, remove } = useChannelLog(server, spaceId, channelId);
  const { log, header, outcome, token, newAfter, loadingOlder } = state;
  const [active, setActive] = useState(AppState.currentState === "active");
  // The composer's height as drawn, for the list to clear.
  const [composerHeight, setComposerHeight] = useState(PILL);
  // Where the screen starts in the window (under the stack's header): the
  // avoiding view measures itself against its parent and needs that
  // offset to know how much of it the keyboard covers.
  const [top, setTop] = useState(0);
  // The message whose menu is open, by id: it closes with the message if
  // that is deleted, and with the channel if that goes.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // What the server refused, for a moment: the latest one replaces the
  // one before it.
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screen = useRef<ComponentRef<typeof View>>(null);
  const list = useRef<FlatList<GroupedRow>>(null);
  // What this screen remembers about the channel shown: the marker it
  // moved and whether it has landed. Another channel starts afresh.
  const marked = useRef("");
  const landed = useRef(false);
  const shownChannel = useRef(channelId);
  if (shownChannel.current !== channelId) {
    shownChannel.current = channelId;
    marked.current = "";
    landed.current = false;
    if (menuFor) setMenuFor(null);
  }

  useEffect(() => {
    const sub = AppState.addEventListener("change", (appState) => setActive(appState === "active"));
    return () => sub.remove();
  }, []);

  // The channel's shown rows, oldest first; the same array while nothing
  // shown changed.
  const messages = channelItems(log);

  const openMenu = useCallback((message: Message) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setMenuFor(message.id);
  }, []);
  const closeMenu = useCallback(() => setMenuFor(null), []);
  const notify = useCallback((title: string, body: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice({ title, body });
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );
  const reactTo = useCallback(
    (message: Message, emoji: string) => {
      react(message, emoji).catch((err) => notify("Couldn't react", errorText(err)));
    },
    [react, notify],
  );
  const deleteMessage = useCallback(
    (message: Message) => {
      remove(message).catch((err) => notify("Couldn't delete the message", errorText(err)));
    },
    [remove, notify],
  );
  const menuMessage = menuFor ? messages.find((message) => message.id === menuFor) : undefined;
  // The menu closes without its own fade, by an abrupt unmount, when the
  // message goes (deleted, or left as a placeholder) or the channel does;
  // the id it held is let go too. A closing animation for these is a
  // later slice's.
  const menuGone = !!menuFor && (!menuMessage || menuMessage.deleted || !!outcome);
  useEffect(() => {
    if (menuGone) setMenuFor(null);
  }, [menuGone]);

  // The reader's marker follows the newest message while the channel is
  // on screen with the app open, as on web.
  const newestId = messages.at(-1)?.id ?? "";
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
  // The composer sits GAP above the home indicator, or above the keyboard
  // while that is up (the avoiding view's padding ends at its top edge).
  const composerBottom = keyboard > 0 ? GAP : insets.bottom + GAP;

  return (
    <View
      ref={screen}
      style={styles.screen}
      onLayout={() => screen.current?.measureInWindow((_windowX, windowY) => setTop(windowY))}
    >
      <Stack.Screen
        options={{
          headerTitle: () => <ChannelTitle channel={channel} spaceName={space.name} memberCount={memberCount} />,
        }}
      />
      <KeyboardAvoidingView style={styles.screen} behavior="padding" keyboardVerticalOffset={top}>
        {/* The avoiding view pads its bottom for the keyboard; the composer
            is placed from this view's bottom, which that padding moves. */}
        <View style={styles.screen}>
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
                  onLongPress={openMenu}
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
            // On a drag, not interactively: the card follows the keyboard's
            // hide event, which iOS posts only at the end of an interactive
            // drag, so the card would float over an empty strip while the
            // keyboard followed the finger. Following it needs
            // react-native-keyboard-controller, a follow-up.
            keyboardDismissMode="on-drag"
            // Drawn upside down, so the top padding is the bottom edge: the
            // list scrolls under the composer, and its newest message clears it.
            contentContainerStyle={[styles.content, { paddingTop: 12 + composerHeight + composerBottom }]}
            // Rows in view stay put when that padding changes (the composer
            // growing a line) and when a row arrives, unless the reader is at
            // the newest edge, where the list follows it.
            maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 80 }}
            ListFooterComponent={
              loadingOlder ? (
                <ActivityIndicator style={styles.edge} color={theme.textMuted} />
              ) : !hasOlder ? (
                <Text style={styles.beginning}>
                  {messages.length === 0 ? "No messages yet. " : ""}This is the beginning of #{channel.name}.
                </Text>
              ) : !olderFits(log) ? (
                <Text style={styles.beginning}>Showing the latest {messages.length.toLocaleString()} messages.</Text>
              ) : undefined
            }
          />
          <View
            style={[styles.composer, { bottom: composerBottom }]}
            onLayout={(event) => setComposerHeight(event.nativeEvent.layout.height)}
          >
            <Composer key={channelId} channelName={channel.name} send={send} />
          </View>
          {notice && (
            <View
              style={[styles.toast, { bottom: composerBottom + composerHeight + GAP }]}
              accessibilityRole="alert"
              testID="channel-notice"
              pointerEvents="none"
            >
              <Text style={styles.toastTitle}>{notice.title}</Text>
              <Text style={styles.toastBody} numberOfLines={2}>
                {notice.body}
              </Text>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
      {menuMessage && !menuMessage.deleted && (
        <MessageMenu
          message={menuMessage}
          myUserId={myUserId}
          canModerate={canDeleteAnyMessage(space)}
          origin={server.origin}
          token={token}
          onReact={(emoji) => reactTo(menuMessage, emoji)}
          onDelete={() => deleteMessage(menuMessage)}
          onClose={closeMenu}
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
    content: {
      paddingVertical: 12,
    },
    composer: {
      position: "absolute",
      left: 0,
      right: 0,
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
    toast: {
      position: "absolute",
      left: 16,
      right: 16,
      paddingHorizontal: 14,
      paddingVertical: 10,
      gap: 2,
      borderRadius: tokens.radiusMd,
      backgroundColor: theme.panel,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      boxShadow: theme.scheme === "dark" ? "0 6px 20px rgba(0, 0, 0, 0.35)" : "0 6px 20px rgba(30, 25, 20, 0.16)",
    },
    toastTitle: {
      color: theme.danger,
      fontSize: tokens.textUi,
      fontWeight: "600",
    },
    toastBody: {
      color: theme.text,
      fontSize: tokens.textUi,
      lineHeight: tokens.textUi * tokens.leadingUi,
    },
  });
}
