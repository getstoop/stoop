import { Code, ConnectError } from "@connectrpc/connect";
import type { DirectMessage } from "@stoop/gen/stoop/chat/v1/chat_pb";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type Conversations, loadConversations, touchesConversations } from "../../api/conversations";
import { hostOf } from "../../api/probe";
import { sessionToken } from "../../api/servers";
import { PencilIcon } from "../../components/Icons";
import ServerHeader from "../../components/ServerHeader";
import TabNotice from "../../components/TabNotice";
import { usePushOnce } from "../../hooks/usePushOnce";
import { useServerEvents } from "../../realtime/RealtimeProvider";
import type { SavedServer } from "../../servers";
import { channelRoute } from "../Channel/routes";
import { type Theme, tokens, useTheme } from "../../theme";
import ConversationRow from "./ConversationRow";

// The Messages tab: this account's direct messages on the current server,
// newest first, as web's DM list (web/src/routes/DirectMessages), each
// with its newest message. Loaded on opening, on a pull, on coming back
// to the app, and a moment after the socket says a conversation changed.
// A row opens its conversation (the channel screen with no space); the
// pencil opens New message over the tab.

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
  const open = useCallback(
    (dm: DirectMessage) => {
      const channelId = dm.channel?.id;
      if (channelId) pushOnce(() => router.push(channelRoute(server.id, "", channelId)));
    },
    [pushOnce, router, server.id],
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
            <ConversationRow
              dm={item}
              meId={ready.list.reader.id}
              serverId={server.id}
              origin={server.origin}
              token={ready.token}
              onPress={open}
            />
          )}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pull} tintColor={theme.textMuted} />}
          ListEmptyComponent={<Text style={styles.empty}>No conversations yet.</Text>}
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
