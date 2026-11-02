import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { loadSignedInMe, type SignedInMe } from "../../api/me";
import { hostOf } from "../../api/probe";
import TabNotice from "../../components/TabNotice";
import type { SavedServer } from "../../servers";
import { type Theme, useTheme } from "../../theme";
import ProfileForm from "./ProfileForm";

// Edit profile, pushed over the You tab: who you are on this server, asked
// of the server on opening so the form starts from what it holds.

type State = { state: "loading" } | SignedInMe;

export default function EditProfile({ server }: { server: SavedServer }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const router = useRouter();
  const [view, setView] = useState<State>({ state: "loading" });

  useEffect(() => {
    let live = true;
    loadSignedInMe(server).then((next) => live && setView(next));
    return () => {
      live = false;
    };
  }, [server]);

  const retry = async () => {
    setView({ state: "loading" });
    setView(await loadSignedInMe(server));
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
