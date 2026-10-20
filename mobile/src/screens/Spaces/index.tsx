import { Code, ConnectError } from "@connectrpc/connect";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { hostOf } from "../../api/probe";
import { sessionToken } from "../../api/servers";
import { loadSpaces, type SpaceListing } from "../../api/spaces";
import { ChevronDownIcon } from "../../components/Icons";
import type { SavedServer } from "../../servers";
import { type Theme, tokens, useTheme } from "../../theme";
import SpaceRow from "./SpaceRow";

// The Spaces tab: the spaces this account is in on the current server,
// with what is waiting in each. The header names the server and opens
// the switcher. Loaded on opening, on a pull, and on
// coming back to the app.

type State =
  | { state: "loading" }
  | { state: "ready"; token: string; spaces: SpaceListing[] }
  // As the signed-in stand-in: only the server saying the session is over
  // counts as signed out.
  | { state: "ended" }
  | { state: "failed" };

export default function Spaces({ server }: { server: SavedServer }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(theme);
  const router = useRouter();
  const [list, setList] = useState<State>({ state: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const token = await sessionToken(server.id).catch(() => null);
    if (!token) return { state: "ended" } as const;
    try {
      return { state: "ready", token, spaces: await loadSpaces(server.origin, token) } as const;
    } catch (err) {
      return err instanceof ConnectError && err.code === Code.Unauthenticated
        ? ({ state: "ended" } as const)
        : ({ state: "failed" } as const);
    }
  }, [server]);

  useEffect(() => {
    let live = true;
    const refresh = () => load().then((next) => live && setList(next));
    refresh();
    const sub = AppState.addEventListener("change", (s) => s === "active" && refresh());
    return () => {
      live = false;
      sub.remove();
    };
  }, [load]);

  const pull = async () => {
    setRefreshing(true);
    setList(await load());
    setRefreshing(false);
  };

  const retry = async () => {
    setList({ state: "loading" });
    setList(await load());
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${server.name}. Switch server`}
          testID="server-switcher"
          onPress={() => router.push({ pathname: "/servers", params: { current: server.id } })}
          style={({ pressed }) => [styles.switcher, pressed && styles.pressed]}
        >
          <View style={styles.tile}>
            <Text style={styles.tileLetter}>{server.name.trim().charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.server} numberOfLines={1}>
            {server.name}
          </Text>
          <ChevronDownIcon color={theme.textMuted} />
        </Pressable>
      </View>
      <Text style={styles.title} accessibilityRole="header">
        Spaces
      </Text>
      {list.state === "loading" && <ActivityIndicator style={styles.center} color={theme.textMuted} />}
      {list.state === "ended" && (
        <View style={styles.notice} accessibilityRole="alert">
          <Text style={styles.body}>
            Your sign-in to {server.name} has ended. Sign in again to carry on.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              router.replace({ pathname: "/sign-in", params: { server: server.origin } })
            }
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          >
            <Text style={styles.buttonLabel}>Sign in again</Text>
          </Pressable>
        </View>
      )}
      {list.state === "failed" && (
        <View style={styles.notice} accessibilityRole="alert">
          <Text style={styles.body}>Couldn't reach {hostOf(server.origin)}.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={retry}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          >
            <Text style={styles.buttonLabel}>Try again</Text>
          </Pressable>
        </View>
      )}
      {list.state === "ready" && (
        <FlatList
          data={list.spaces}
          keyExtractor={(l) => l.space.id}
          renderItem={({ item }) => (
            <SpaceRow listing={item} origin={server.origin} token={list.token} />
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={pull} tintColor={theme.textMuted} />
          }
          ListEmptyComponent={
            <Text style={[styles.body, styles.empty]}>You're not in any spaces here yet.</Text>
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
    header: {
      flexDirection: "row",
      alignItems: "center",
      height: 44,
      paddingHorizontal: 16,
    },
    switcher: {
      flexDirection: "row",
      alignItems: "center",
      flexShrink: 1,
      gap: 8,
      height: 44,
      paddingRight: 8,
    },
    tile: {
      width: 28,
      height: 28,
      borderRadius: tokens.radiusMd,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.accentSoft,
    },
    tileLetter: {
      color: theme.accent,
      fontSize: tokens.textUi,
      fontWeight: "700",
    },
    server: {
      flexShrink: 1,
      color: theme.text,
      fontSize: tokens.textBody,
      fontWeight: "600",
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
    empty: {
      paddingHorizontal: 12,
      color: theme.textMuted,
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
