import { Code, ConnectError } from "@connectrpc/connect";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { hostOf } from "../../api/probe";
import { sessionToken } from "../../api/servers";
import { loadSpaces, type SpaceListing } from "../../api/spaces";
import ServerHeader from "../../components/ServerHeader";
import TabNotice from "../../components/TabNotice";
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
      <ServerHeader server={server} />
      <Text style={styles.title} accessibilityRole="header">
        Spaces
      </Text>
      {list.state === "loading" && <ActivityIndicator style={styles.center} color={theme.textMuted} />}
      {list.state === "ended" && (
        <TabNotice
          message={`Your sign-in to ${server.name} has ended. Sign in again to carry on.`}
          action={{
            label: "Sign in again",
            onPress: () => router.replace({ pathname: "/sign-in", params: { server: server.origin } }),
          }}
        />
      )}
      {list.state === "failed" && (
        <TabNotice
          message={`Couldn't reach ${hostOf(server.origin)}.`}
          action={{ label: "Try again", onPress: retry }}
        />
      )}
      {list.state === "ready" && (
        <FlatList
          data={list.spaces}
          keyExtractor={(l) => l.space.id}
          renderItem={({ item }) => (
            <SpaceRow
              listing={item}
              origin={server.origin}
              token={list.token}
              onPress={() => router.push(`/s/${server.id}/space/${item.space.id}`)}
            />
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
    body: {
      color: theme.text,
      fontSize: tokens.textBody,
      lineHeight: tokens.textBody * tokens.leadingBody,
    },
    empty: {
      paddingHorizontal: 12,
      color: theme.textMuted,
    },
  });
}
