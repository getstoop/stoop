import { Code, ConnectError } from "@connectrpc/connect";
import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { hostOf } from "../../api/probe";
import { sessionToken } from "../../api/servers";
import { loadSpaces, touchesSpaces } from "../../api/spaces";
import ServerHeader from "../../components/ServerHeader";
import Skeleton from "../../components/Skeleton";
import TabNotice from "../../components/TabNotice";
import { useSignInAgain } from "../../hooks/useSignInAgain";
import { useServerEvents } from "../../realtime/RealtimeProvider";
import type { SavedServer } from "../../servers";
import { type Theme, tokens, useTheme } from "../../theme";
import Pane from "./Pane";
import PaneScroll from "./PaneScroll";
import PaneSkeleton from "./PaneSkeleton";
import Rail from "./Rail";
import RailSkeleton from "./RailSkeleton";
import { afterLoad } from "./reloads";
import { useQuietReload } from "./useQuietReload";
import { useSelectedSpace } from "./useSelectedSpace";

// The Spaces tab, three levels at once: the server across the top (its
// header opens the switcher), the spaces this account is in on it down
// a rail at the left, with what is waiting in each, and the selected
// space's channels in the pane that fills the rest; the space is the
// one last picked on this server (./useSelectedSpace.ts). The spaces are
// loaded on opening and on a pull of the pane, and again, while the tab
// is in sight, on coming back to the app and, after a moment's quiet,
// whenever the realtime socket says something in one of them changed,
// or one came or went; out of sight (under a channel, behind another
// tab) a change is remembered and reloaded once on return. A reload
// that fails keeps the list already shown: only the first load and Try
// again say the server couldn't be reached.

type State =
  | { state: "loading" }
  | { state: "ready"; token: string; spaces: Space[] }
  // As the You tab: only the server saying the session is over
  // counts as signed out.
  | { state: "ended" }
  | { state: "failed" };

export default function Spaces({ server }: { server: SavedServer }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(theme);
  const signInAgain = useSignInAgain(server.origin);
  const [list, setList] = useState<State>({ state: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const spaces = list.state === "ready" ? list.spaces : undefined;
  const { settled, selected, select } = useSelectedSpace(server.id, spaces);
  const space = spaces?.find((one) => one.id === selected);

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

  // As the Messages tab: only the latest load started is shown, and
  // leaving the screen makes none the latest.
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const mine = ++latest.current;
    const next = await load();
    if (mine === latest.current) setList((shown) => afterLoad(shown, next));
  }, [load]);

  const quiet = useQuietReload(refresh);
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener("change", (state) => state === "active" && quiet.now());
    return () => {
      latest.current++;
      sub.remove();
    };
  }, [refresh, quiet]);

  const end = useCallback(() => {
    latest.current++;
    quiet.cancel();
    setList({ state: "ended" });
  }, [quiet]);
  useServerEvents(server.id, (event) => {
    if (event.payload.case === "credentialRevoked") end();
    else if (touchesSpaces(event)) quiet.soon();
  });

  const retry = async () => {
    setList({ state: "loading" });
    await refresh();
  };

  const pull = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ServerHeader server={server} />
      {/* Until the remembered space is read too: no space is picked without it. */}
      {(list.state === "loading" || (list.state === "ready" && !settled)) && (
        <Skeleton style={styles.body}>
          <RailSkeleton />
          <View style={styles.pane}>
            <PaneSkeleton header />
          </View>
        </Skeleton>
      )}
      {list.state === "ended" && (
        <TabNotice
          message={`Your sign-in to ${server.name} has ended. Sign in again to carry on.`}
          action={{
            label: "Sign in again",
            onPress: signInAgain,
          }}
        />
      )}
      {list.state === "failed" && (
        <TabNotice
          message={`Couldn't reach ${hostOf(server.origin)}.`}
          action={{ label: "Try again", onPress: retry }}
        />
      )}
      {list.state === "ready" && settled && (
        // Measures the safe area where the body is, so the rail and the
        // pane know what lies over their bottom (./useBottomObstruction.ts).
        <SafeAreaProvider style={styles.body}>
          <Rail
            spaces={list.spaces}
            selected={selected}
            origin={server.origin}
            token={list.token}
            onSelect={select}
          />
          <View style={styles.pane}>
            {space ? (
              // One pane per space, so a space picked starts from its
              // own loading state, never the last one's channels.
              <Pane key={space.id} server={server} space={space} onReloadSpaces={refresh} onEnded={end} />
            ) : (
              <PaneScroll refreshing={refreshing} onRefresh={pull}>
                <Text style={styles.empty}>You're not in any spaces here yet.</Text>
              </PaneScroll>
            )}
          </View>
        </SafeAreaProvider>
      )}
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    // The server's bar and the rail sit on the canvas; the pane is a
    // surface laid over its corner.
    screen: {
      flex: 1,
      backgroundColor: theme.canvas,
    },
    body: {
      flex: 1,
      flexDirection: "row",
    },
    pane: {
      flex: 1,
      borderTopWidth: 1,
      borderLeftWidth: 1,
      borderColor: theme.border,
      borderTopLeftRadius: tokens.radiusXl,
      backgroundColor: theme.surface,
      overflow: "hidden",
    },
    // With the scroll's own 4 and 8, the pane's 20.
    empty: {
      marginTop: 16,
      marginHorizontal: 12,
      color: theme.textMuted,
      fontSize: tokens.textBody,
      lineHeight: tokens.textBody * tokens.leadingBody,
    },
  });
}
