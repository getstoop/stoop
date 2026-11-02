import { Code, ConnectError } from "@connectrpc/connect";
import type { User } from "@stoop/gen/stoop/auth/v1/auth_pb";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { loadMe } from "../../api/me";
import { hostOf } from "../../api/probe";
import { sessionToken } from "../../api/servers";
import TabNotice from "../../components/TabNotice";
import type { SavedServer } from "../../servers";
import { type Theme, useTheme } from "../../theme";
import ProfileForm from "./ProfileForm";

// Edit profile, pushed over the You tab: who you are on this server, asked
// of the server on opening so the form starts from what it holds.

type State =
  | { state: "loading" }
  | { state: "ready"; token: string; user: User }
  | { state: "ended" }
  | { state: "failed" };

export default function EditProfile({ server }: { server: SavedServer }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const router = useRouter();
  const [view, setView] = useState<State>({ state: "loading" });

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

  useEffect(() => {
    let live = true;
    load().then((next) => live && setView(next));
    return () => {
      live = false;
    };
  }, [load]);

  const retry = async () => {
    setView({ state: "loading" });
    setView(await load());
  };

  if (view.state === "ready") return <ProfileForm server={server} token={view.token} me={view.user} />;
  return (
    <View style={styles.screen}>
      {view.state === "loading" && <ActivityIndicator style={styles.loading} color={theme.textMuted} />}
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
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.surface,
    },
    loading: {
      marginTop: 24,
    },
  });
}
