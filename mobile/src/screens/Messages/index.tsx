import { Code, ConnectError } from "@connectrpc/connect";
import type { DirectMessage } from "@stoop/gen/stoop/chat/v1/chat_pb";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { LinearTransition } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAlerts } from "../../alerts/AlertsProvider";
import { setChannelMuted } from "../../api/channels";
import { type Conversations, closeConversation, loadConversations, touchesConversations } from "../../api/conversations";
import { errorText } from "../../api/errors";
import { hostOf } from "../../api/probe";
import { sessionToken } from "../../api/servers";
import { conversationLink } from "../../api/shareLinks";
import { PencilIcon } from "../../components/Icons";
import ServerChipOverlay from "../../components/ServerChipOverlay";
import TabNotice from "../../components/TabNotice";
import { usePushOnce } from "../../hooks/usePushOnce";
import { useServerChipRoom } from "../../hooks/useServerChipRoom";
import { useSheetNotice } from "../../hooks/useSheetNotice";
import { useSignInAgain } from "../../hooks/useSignInAgain";
import { useServerEvents } from "../../realtime/RealtimeProvider";
import type { SavedServer } from "../../servers";
import { channelRoute } from "../Channel/routes";
import { type Theme, tokens, useTheme } from "../../theme";
import ConversationMenu from "./ConversationMenu";
import ConversationRow, { type ConversationAction } from "./ConversationRow";
import SwipeToClose from "./SwipeToClose";

// The Messages tab: this account's direct messages on the current server,
// newest first, as web's DM list (web/src/routes/DirectMessages), each
// with its newest message. Loaded on opening, on a pull, on coming back
// to the app, and a moment after the socket says a conversation changed.
// A row opens its conversation (the channel screen with no space), a
// long press its menu (ConversationMenu), and a swipe left shows Close
// (SwipeToClose): a mute or a close shows at once and is put back, and
// said, if the server refuses it. The pencil opens New message over the
// tab.

const RELOAD_DELAY_MS = 300;

type State =
  | { state: "loading" }
  | { state: "ready"; token: string; list: Conversations }
  // As the Spaces tab: only the server saying the session is over counts
  // as signed out.
  | { state: "ended" }
  // Never loaded; a later load that fails keeps what was shown.
  | { state: "failed" };

export default function Messages({ server }: { server: SavedServer }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const chipRoom = useServerChipRoom();
  const styles = makeStyles(theme);
  const router = useRouter();
  const signInAgain = useSignInAgain(server.origin);
  const { refresh: refreshAlerts } = useAlerts();
  const [view, setView] = useState<State>({ state: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (): Promise<State> => {
    const token = await sessionToken(server.id).catch(() => null);
    if (!token) return { state: "ended" };
    try {
      return { state: "ready", token, list: await loadConversations(server.origin, token) };
    } catch (err) {
      return err instanceof ConnectError && err.code === Code.Unauthenticated ? { state: "ended" } : { state: "failed" };
    }
  }, [server]);

  // Loads can overlap (opening, a pull, coming back, an event), and an
  // older one finishing last must not undo a newer one: only the latest
  // started is shown, and leaving the screen makes none the latest.
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const mine = ++latest.current;
    const next = await load();
    if (mine !== latest.current) return;
    setView((held) => (next.state === "failed" && held.state === "ready" ? held : next));
  }, [load]);

  // Events come in bursts (a message sent is also its channel read), so a
  // moment's quiet goes before one reload.
  const reload = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener("change", (state) => state === "active" && refresh());
    return () => {
      latest.current++;
      sub.remove();
      clearTimeout(reload.current);
    };
  }, [refresh]);
  useServerEvents(server.id, (event) => {
    if (event.payload.case === "credentialRevoked") {
      latest.current++;
      clearTimeout(reload.current);
      setView({ state: "ended" });
      return;
    }
    if (!touchesConversations(event)) return;
    clearTimeout(reload.current);
    reload.current = setTimeout(refresh, RELOAD_DELAY_MS);
  });

  const pull = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const retry = async () => {
    setView({ state: "loading" });
    await refresh();
  };

  const ready = view.state === "ready" ? view : null;
  const pushOnce = usePushOnce();
  // The row resting open on Close, closed as another is swiped and as a
  // conversation opens.
  const openRow = useRef<SwipeableMethods | null>(null);
  const swiped = useCallback((row: SwipeableMethods) => {
    if (openRow.current !== row) openRow.current?.close();
    openRow.current = row;
  }, []);
  const open = useCallback(
    (dm: DirectMessage) => {
      openRow.current?.close();
      openRow.current = null;
      const channelId = dm.channel?.id;
      if (channelId) pushOnce(() => router.push(channelRoute(server.id, "", channelId)));
    },
    [pushOnce, router, server.id],
  );

  // The menu's conversation as the list now draws it, so a mute or a
  // reload under it shows; once off the list (closed), as it was when
  // the menu opened, so the sheet can slide out over it.
  const [menuFor, setMenuFor] = useState<DirectMessage | null>(null);
  const menuDm = menuFor && (ready?.list.dms.find((dm) => dm.channel?.id === menuFor.channel?.id) ?? menuFor);
  // A refusal is said once the sheet has gone.
  const { say, opened, closed } = useSheetNotice();
  const openMenu = useCallback(
    (dm: DirectMessage) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      opened();
      setMenuFor(dm);
    },
    [opened],
  );
  const closeMenu = useCallback(() => {
    setMenuFor(null);
    closed();
  }, [closed]);

  // The list as shown, changed before the server says so. A load already
  // on its way knows nothing of the change, so it is dropped (latest);
  // the list is asked for again once the server has answered.
  const change = useCallback((edit: (dms: DirectMessage[]) => DirectMessage[]) => {
    latest.current++;
    setView((held) => (held.state === "ready" ? { ...held, list: { ...held.list, dms: edit(held.list.dms) } } : held));
  }, []);

  // The session's token, read when an action runs, so the actions (and
  // the rows given them) stay the same across loads.
  const token = useRef("");
  token.current = ready?.token ?? "";

  const act = useCallback(
    (dm: DirectMessage, action: ConversationAction) => {
      const id = dm.channel?.id;
      if (!id || !token.current) return;
      if (action === "copyLink") {
        Clipboard.setStringAsync(conversationLink(server.origin, id)).then(
          () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
          () => say("Couldn't copy the link"),
        );
        return;
      }
      if (action === "mute") {
        const muted = !dm.channel?.muted;
        const set = (to: boolean) =>
          change((dms) => dms.map((d) => (d.channel?.id === id ? { ...d, channel: { ...d.channel, muted: to } } : d)));
        set(muted);
        setChannelMuted(server.origin, token.current, id, muted)
          .catch((err) => {
            set(!muted);
            say(muted ? "Couldn't mute the conversation" : "Couldn't unmute the conversation", errorText(err));
          })
          .finally(refresh);
        return;
      }
      change((dms) => dms.filter((d) => d.channel?.id !== id));
      // A close is told to nobody, this tab's badge included: a
      // conversation's unread messages counted there until now.
      closeConversation(server.origin, token.current, id)
        .catch((err) => say("Couldn't close the conversation", errorText(err)))
        .finally(() => {
          refresh();
          refreshAlerts();
        });
    },
    [change, refresh, refreshAlerts, say, server.origin],
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* The tab's title and, at the other end of its row, its one
          button. */}
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">
          Messages
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New message"
          testID="new-message"
          onPress={() => pushOnce(() => router.push({ pathname: "/s/[id]/new-message", params: { id: server.id } }))}
          style={({ pressed }) => [styles.compose, pressed && styles.composePressed]}
        >
          <PencilIcon color={theme.accent} />
        </Pressable>
      </View>
      {view.state === "loading" && <ActivityIndicator style={styles.center} color={theme.textMuted} />}
      {view.state === "ended" && (
        <TabNotice
          message={`Your sign-in to ${server.name} has ended. Sign in again to carry on.`}
          action={{
            label: "Sign in again",
            onPress: signInAgain,
          }}
        />
      )}
      {view.state === "failed" && (
        <TabNotice message={`Couldn't reach ${hostOf(server.origin)}.`} action={{ label: "Try again", onPress: retry }} />
      )}
      {ready && (
        <Animated.FlatList
          data={ready.list.dms}
          // Rows close up over one that has gone, and move when a reload
          // reorders them.
          itemLayoutAnimation={LinearTransition.duration(tokens.dur)}
          keyExtractor={(dm) => dm.channel?.id ?? ""}
          renderItem={({ item }) => (
            <SwipeToClose onClose={() => act(item, "close")} onSwipe={swiped}>
              <ConversationRow
                dm={item}
                meId={ready.list.reader.id}
                serverId={server.id}
                origin={server.origin}
                token={ready.token}
                onPress={open}
                onLongPress={openMenu}
                onAction={act}
              />
            </SwipeToClose>
          )}
          contentContainerStyle={[styles.list, { paddingBottom: LIST_PADDING + chipRoom }]}
          scrollIndicatorInsets={{ bottom: chipRoom }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pull} tintColor={theme.textMuted} />}
          ListEmptyComponent={<Text style={styles.empty}>No conversations yet.</Text>}
        />
      )}
      {ready && menuDm && (
        <ConversationMenu
          dm={menuDm}
          meId={ready.list.reader.id}
          serverId={server.id}
          origin={server.origin}
          token={ready.token}
          onAction={(action) => act(menuDm, action)}
          onClose={closeMenu}
        />
      )}
      <ServerChipOverlay />
    </View>
  );
}

// Under the last of the list, before the room the server chip takes
// (hooks/useServerChipRoom.ts).
const LIST_PADDING = 16;

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.surface,
    },
    compose: {
      width: 44,
      height: 44,
      borderRadius: 22,
      // The row is as tall as the title's line, as Activity's title
      // is, so the two tabs' lists start at one height.
      marginVertical: -5,
      alignItems: "center",
      justifyContent: "center",
    },
    composePressed: {
      backgroundColor: theme.hover,
    },
    // The button's own 44pt square holds its icon off the edge.
    head: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 12,
      marginBottom: 8,
      paddingLeft: 20,
      paddingRight: 8,
    },
    title: {
      flexShrink: 1,
      color: theme.text,
      fontSize: tokens.textDisplay,
      lineHeight: tokens.textDisplay * tokens.leadingTight,
      fontWeight: "700",
    },
    center: {
      marginTop: 24,
    },
    list: {
      paddingHorizontal: 8,
    },
    empty: {
      marginVertical: 24,
      marginHorizontal: 12,
      color: theme.textMuted,
      fontSize: tokens.textBody,
      lineHeight: tokens.textBody * tokens.leadingBody,
    },
  });
}
