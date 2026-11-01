import { Code, ConnectError } from "@connectrpc/connect";
import type { User } from "@stoop/gen/stoop/auth/v1/auth_pb";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { loadMe } from "../../api/me";
import { hostOf } from "../../api/probe";
import { sessionToken } from "../../api/servers";
import TabNotice from "../../components/TabNotice";
import { usePushOnce } from "../../hooks/usePushOnce";
import { useServerEvents } from "../../realtime/RealtimeProvider";
import type { SavedServer } from "../../servers";
import { type Theme, themeList, useTheme, useThemeName } from "../../theme";
import Identity from "./Identity";
import Section from "./Section";
import SettingRow from "./SettingRow";
import SignOutButton from "./SignOutButton";

// The You tab: who you are on the current server, what is set on this
// phone, and signing out. Loaded on opening, on a pull, on coming back to
// the app, and a moment after the socket says this account's username or
// avatar changed (a server sends no event for its name or pronouns). What
// is set on this phone needs no server, so it stays when the server can't
// say who you are, and so does the way out.

const RELOAD_DELAY_MS = 300;

type State =
  | { state: "loading" }
  | { state: "ready"; token: string; user: User }
  // As the Spaces tab: only the server saying the session is over counts
  // as signed out.
  | { state: "ended" }
  // Never loaded; a later load that fails keeps what was shown.
  | { state: "failed" };

export default function You({ server }: { server: SavedServer }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(theme);
  const router = useRouter();
  const pushOnce = usePushOnce();
  const [view, setView] = useState<State>({ state: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [themeName] = useThemeName();
  const themeLabel = themeList.find((t) => t.name === themeName)?.label ?? themeName;

  const load = useCallback(async (): Promise<State> => {
    const token = await sessionToken(server.id).catch(() => null);
    if (!token) return { state: "ended" };
    try {
      const user = await loadMe(server.origin, token);
      return user ? { state: "ready", token, user } : { state: "ended" };
    } catch (err) {
      return err instanceof ConnectError && err.code === Code.Unauthenticated ? { state: "ended" } : { state: "failed" };
    }
  }, [server]);

  // As the Messages tab: only the latest load started is shown, and
  // leaving the screen makes none the latest.
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const mine = ++latest.current;
    const next = await load();
    if (mine !== latest.current) return;
    setView((held) => (next.state === "failed" && held.state === "ready" ? held : next));
  }, [load]);

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

  // One change to this account arrives once per space it is in, so a
  // moment's quiet goes before one reload. Ready follows a reconnect.
  const meId = view.state === "ready" ? view.user.id : "";
  useServerEvents(server.id, (event) => {
    const { payload } = event;
    if (payload.case !== "ready" && !(payload.case === "memberUpdated" && payload.value.userId === meId)) return;
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

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pull} tintColor={theme.textMuted} />}
      >
        {view.state === "loading" && <ActivityIndicator style={styles.loading} color={theme.textMuted} />}
        {view.state === "ended" && (
          <TabNotice
            flush
            message={`Your sign-in to ${server.name} has ended. Sign in again to carry on.`}
            action={{
              label: "Sign in again",
              onPress: () => router.replace({ pathname: "/sign-in", params: { server: server.origin } }),
            }}
          />
        )}
        {view.state === "failed" && (
          <TabNotice
            flush
            message={`Couldn't reach ${hostOf(server.origin)}. You're still signed in.`}
            action={{ label: "Try again", onPress: retry }}
          />
        )}
        {view.state === "ready" && <Identity user={view.user} server={server} token={view.token} />}
        <Section title="This phone">
          <SettingRow
            label="Theme"
            value={themeLabel}
            testID="theme-row"
            onPress={() => pushOnce(() => router.push("/theme"))}
          />
          <SettingRow label="Notifications" value="Mentions & messages" divided />
        </Section>
        <SignOutButton server={server} />
      </ScrollView>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.surface,
    },
    // The identity's height, so the rows don't move when it arrives.
    loading: {
      height: 64,
    },
    content: {
      gap: 16,
      paddingTop: 8,
      paddingHorizontal: 16,
      paddingBottom: 16,
    },
  });
}
