import { useIsFocused, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { loadSignedInMe, type SignedInMe } from "../../api/me";
import { hostOf } from "../../api/probe";
import TabNotice from "../../components/TabNotice";
import { usePushOnce } from "../../hooks/usePushOnce";
import { useSignInAgain } from "../../hooks/useSignInAgain";
import { useServerEvents } from "../../realtime/RealtimeProvider";
import { type SavedServer, useServers } from "../../servers";
import { useWaiting } from "../../servers/useWaiting";
import { type Theme, themeList, useTheme, useThemeName } from "../../theme";
import Identity from "./Identity";
import Section from "./Section";
import ServersSection from "./ServersSection";
import SettingRow from "./SettingRow";
import SignOutButton from "./SignOutButton";

// The You tab: who you are on the current server, every server on this
// phone, what is set on it, and signing out. Loaded on opening, on a pull,
// on coming back to it or the app, and a moment after the socket says this
// account's username or avatar changed (a server sends no event for its
// name or pronouns). It stays mounted under the other tabs and anything
// pushed over it; off screen, the app and the socket set off no loads,
// since coming back to it loads anyway. What is set on this phone needs no
// server, so it stays when the server can't say who you are, and so does
// the way out.

const RELOAD_DELAY_MS = 300;

// Failed: never loaded; a later load that fails keeps what was shown.
type State = { state: "loading" } | SignedInMe;

export default function You({ server }: { server: SavedServer }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(theme);
  const router = useRouter();
  const signInAgain = useSignInAgain(server.origin);
  const pushOnce = usePushOnce();
  const [view, setView] = useState<State>({ state: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [themeName] = useThemeName();
  const themeLabel = themeList.find((t) => t.name === themeName)?.label ?? themeName;

  const { servers } = useServers();
  const { waiting, refresh: refreshWaiting } = useWaiting(servers, server.id);

  // As the Messages tab: only the latest load started is shown, and
  // leaving the screen makes none the latest.
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const mine = ++latest.current;
    const next = await loadSignedInMe(server);
    if (mine !== latest.current) return;
    setView((held) => (next.state === "failed" && held.state === "ready" ? held : next));
  }, [server]);

  // Coming back into view: from another tab, or from Edit with what was
  // just saved, which no event says (a name, pronouns). This is also what
  // catches up on everything skipped while it was off screen.
  const focused = useIsFocused();
  const onScreen = useRef(focused);
  useEffect(() => {
    if (focused && !onScreen.current) {
      refresh();
      refreshWaiting();
    }
    onScreen.current = focused;
  }, [focused, refresh, refreshWaiting]);

  const reload = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active" || !onScreen.current) return;
      refresh();
      refreshWaiting();
    });
    return () => {
      latest.current++;
      sub.remove();
      clearTimeout(reload.current);
    };
  }, [refresh, refreshWaiting]);

  // One change to this account arrives once per space it is in, so a
  // moment's quiet goes before one reload. Ready follows a reconnect.
  const meId = view.state === "ready" ? view.user.id : "";
  useServerEvents(server.id, (event) => {
    // Costs no load, so it doesn't wait to be on screen.
    if (event.payload.case === "credentialRevoked") {
      latest.current++;
      clearTimeout(reload.current);
      setView({ state: "ended" });
      return;
    }
    if (!onScreen.current) return;
    const { payload } = event;
    if (payload.case !== "ready" && !(payload.case === "memberUpdated" && payload.value.userId === meId)) return;
    clearTimeout(reload.current);
    reload.current = setTimeout(refresh, RELOAD_DELAY_MS);
  });

  const pull = async () => {
    setRefreshing(true);
    // The spinner is this tab's own: one unreachable server mustn't hold it.
    refreshWaiting();
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
              onPress: signInAgain,
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
        {view.state === "ready" && (
          <Identity
            user={view.user}
            server={server}
            token={view.token}
            onEdit={() =>
              pushOnce(() => router.push({ pathname: "/s/[id]/edit-profile", params: { id: server.id } }))
            }
          />
        )}
        <ServersSection current={server} waiting={waiting} />
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
