import { Code, ConnectError } from "@connectrpc/connect";
import type { DirectMessage } from "@stoop/gen/stoop/chat/v1/chat_pb";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  type Conversations,
  closeConversation,
  loadConversations,
  setConversationMuted,
  touchesConversations,
} from "../../api/conversations";
import { errorText } from "../../api/errors";
import { hostOf } from "../../api/probe";
import { sessionToken } from "../../api/servers";
import { conversationLink } from "../../api/shareLinks";
import { PencilIcon } from "../../components/Icons";
import ServerHeader from "../../components/ServerHeader";
import TabNotice from "../../components/TabNotice";
import { usePushOnce } from "../../hooks/usePushOnce";
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
  const styles = makeStyles(theme);
  const router = useRouter();
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
  // A refusal is said once the sheet has gone: on iOS an alert over a
  // modal goes with it (as AttachSheet waits for its own).
  const menuOpen = useRef(false);
  const unsaid = useRef<[string, string?] | null>(null);
  const say = useCallback((title: string, body?: string) => {
    if (menuOpen.current) unsaid.current = [title, body];
    else Alert.alert(title, body);
  }, []);
  const openMenu = useCallback((dm: DirectMessage) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    menuOpen.current = true;
    setMenuFor(dm);
  }, []);
  const closeMenu = useCallback(() => {
    menuOpen.current = false;
    setMenuFor(null);
    const held = unsaid.current;
    unsaid.current = null;
    if (held) Alert.alert(...held);
  }, []);

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
        setConversationMuted(server.origin, token.current, id, muted)
          .catch((err) => {
            set(!muted);
            say(muted ? "Couldn't mute the conversation" : "Couldn't unmute the conversation", errorText(err));
          })
          .finally(refresh);
        return;
      }
      change((dms) => dms.filter((d) => d.channel?.id !== id));
      closeConversation(server.origin, token.current, id)
        .catch((err) => say("Couldn't close the conversation", errorText(err)))
        .finally(refresh);
    },
    [change, refresh, say, server.origin],
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ServerHeader
        server={server}
        action={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New message"
            testID="new-message"
            onPress={() => pushOnce(() => router.push({ pathname: "/s/[id]/new-message", params: { id: server.id } }))}
            style={({ pressed }) => [styles.compose, pressed && styles.composePressed]}
          >
            <PencilIcon color={theme.accent} />
          </Pressable>
        }
      />
      <Text style={styles.title} accessibilityRole="header">
        Messages
      </Text>
      {view.state === "loading" && <ActivityIndicator style={styles.center} color={theme.textMuted} />}
      {view.state === "ended" && (
        <TabNotice
          message={`Your sign-in to ${server.name} has ended. Sign in again to carry on.`}
          action={{
            label: "Sign in again",
            onPress: () => router.replace({ pathname: "/sign-in", params: { server: server.origin } }),
          }}
        />
      )}
      {view.state === "failed" && (
        <TabNotice message={`Couldn't reach ${hostOf(server.origin)}.`} action={{ label: "Try again", onPress: retry }} />
      )}
      {ready && (
        <FlatList
          data={ready.list.dms}
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
          contentContainerStyle={styles.list}
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
    </View>
  );
}

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
      alignItems: "center",
      justifyContent: "center",
    },
    composePressed: {
      backgroundColor: theme.hover,
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
      paddingHorizontal: 8,
      paddingBottom: 16,
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
