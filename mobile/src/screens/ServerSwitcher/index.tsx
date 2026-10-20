import { Code, ConnectError } from "@connectrpc/connect";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { sessionToken } from "../../api/servers";
import { mentionTotal } from "../../api/spaces";
import { PlusIcon } from "../../components/Icons";
import { type SavedServer, useServers } from "../../servers";
import { type Theme, tokens, useTheme } from "../../theme";
import ServerRow, { type Waiting } from "./ServerRow";

// The server switcher: a sheet over the Spaces tab listing every server
// on this phone, the current one ticked, each other one with a badge for
// what is waiting there or a note that its sign-in has ended. Each is
// asked once, when the sheet opens.

export default function ServerSwitcher({ current }: { current?: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(theme);
  const router = useRouter();
  const { servers, switchTo } = useServers();
  // By server ID; a server not in here yet is still being asked.
  const [waiting, setWaiting] = useState<Record<string, Waiting>>({});

  useEffect(() => {
    let live = true;
    for (const server of servers) {
      if (server.id === current) continue;
      waitingOn(server).then((w) => live && setWaiting((all) => ({ ...all, [server.id]: w })));
    }
    return () => {
      live = false;
    };
  }, [servers, current]);

  // The sheet closes before the app moves on: a screen pushed from inside
  // a sheet would open inside it. Another server is put first and opened
  // through the start (src/app/index.tsx says why).
  const open = async (server: SavedServer) => {
    if (server.id === current) {
      router.back();
    } else if (waiting[server.id]?.state === "ended") {
      router.back();
      router.push({ pathname: "/sign-in", params: { server: server.origin } });
    } else {
      await switchTo(server.id);
      router.back();
      router.replace("/");
    }
  };

  const addServer = () => {
    router.back();
    router.push("/add-server");
  };

  return (
    <View
      style={[styles.sheet, { paddingBottom: Platform.OS === "ios" ? 8 : insets.bottom + 16 }]}
      testID="server-switcher-sheet"
    >
      <Text style={styles.title} accessibilityRole="header">
        Servers
      </Text>
      {servers.map((server) => (
        <ServerRow
          key={server.id}
          server={server}
          current={server.id === current}
          waiting={waiting[server.id]}
          onPress={() => open(server)}
        />
      ))}
      <View style={styles.divider} />
      <Pressable
        accessibilityRole="button"
        onPress={addServer}
        style={({ pressed }) => [styles.add, pressed && styles.pressed]}
      >
        <View style={styles.addTile}>
          <PlusIcon color={theme.accent} />
        </View>
        <Text style={styles.addLabel}>Add a server</Text>
      </Pressable>
      <Text style={styles.note}>
        Spaces, Activity and Messages show the server you're on. A badge here means something's
        waiting on another one.
      </Text>
    </View>
  );
}

// As the Spaces tab: only the server saying the session is over counts as
// signed out. One that can't be reached just shows no badge.
async function waitingOn(server: SavedServer): Promise<Waiting> {
  const token = await sessionToken(server.id).catch(() => null);
  if (!token) return { state: "ended" };
  try {
    return { state: "ready", mentions: await mentionTotal(server.origin, token) };
  } catch (err) {
    return err instanceof ConnectError && err.code === Code.Unauthenticated
      ? { state: "ended" }
      : { state: "failed" };
  }
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    sheet: {
      paddingTop: 20,
      paddingHorizontal: 8,
      backgroundColor: theme.panel,
    },
    title: {
      marginHorizontal: 12,
      marginBottom: 8,
      color: theme.text,
      fontSize: tokens.textLg,
      fontWeight: "700",
    },
    divider: {
      height: 1,
      marginVertical: 8,
      marginHorizontal: 12,
      backgroundColor: theme.border,
    },
    add: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 56,
      paddingHorizontal: 12,
      borderRadius: tokens.radiusMd,
    },
    pressed: {
      backgroundColor: theme.hover,
    },
    addTile: {
      width: 40,
      height: 40,
      borderRadius: 10,
      borderWidth: 1.5,
      borderStyle: "dashed",
      borderColor: theme.border,
      alignItems: "center",
      justifyContent: "center",
    },
    addLabel: {
      color: theme.accent,
      fontSize: tokens.textBody,
      fontWeight: "600",
    },
    note: {
      marginTop: 8,
      marginHorizontal: 12,
      color: theme.textMuted,
      fontSize: tokens.textUi,
      lineHeight: tokens.textUi * tokens.leadingUi,
    },
  });
}
