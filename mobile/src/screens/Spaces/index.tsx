import { Code, ConnectError } from "@connectrpc/connect";
import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import PaneSkeleton from "./PaneSkeleton";
import Rail from "./Rail";
import RailSkeleton from "./RailSkeleton";
import { useQuietReload } from "./useQuietReload";
import { useSelectedSpace } from "./useSelectedSpace";

// The Spaces tab, three levels at once: the server across the top (its
// header opens the switcher), the spaces this account is in on it down
// a rail at the left, with what is waiting in each, and the selected
// space's channels in the pane that fills the rest. The spaces are
// loaded on opening, on a pull of the pane, on coming back to the app,
// and again, after a moment's quiet, whenever the realtime socket says
// something in one of them changed, or one came or went.

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
  const spaces = list.state === "ready" ? list.spaces : undefined;
  const { selected, select } = useSelectedSpace(spaces);
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
    if (mine === latest.current) setList(next);
  }, [load]);

  const quiet = useQuietReload(refresh);
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener("change", (state) => state === "active" && refresh());
    return () => {
      latest.current++;
      sub.remove();
    };
  }, [refresh]);

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

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ServerHeader server={server} />
      {list.state === "loading" && (
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
      {list.state === "ready" && (
        <View style={styles.body}>
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
              <Pane key={space.id} server={server} space={space} onReloadSpaces={refresh} onGone={refresh} onEnded={end} />
            ) : (
              <Text style={styles.empty}>You're not in any spaces here yet.</Text>
            )}
          </View>
        </View>
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
    empty: {
      marginTop: 20,
      marginHorizontal: 20,
      color: theme.textMuted,
      fontSize: tokens.textBody,
      lineHeight: tokens.textBody * tokens.leadingBody,
    },
  });
}
