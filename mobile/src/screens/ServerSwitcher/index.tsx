import { useNavigation, useRouter } from "expo-router";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PlusIcon } from "../../components/Icons";
import { type SavedServer, useServers } from "../../servers";
import { type ServerNavigation, swapServer } from "../../servers/swapServer";
import { useWaiting } from "../../servers/useWaiting";
import { type Theme, tokens, useTheme } from "../../theme";
import ServerRow from "./ServerRow";

// The server switcher: a sheet over a server's tabs, opened from the
// server chip by the tab bar (components/ServerChip.tsx), listing every
// server on this phone, the current one ticked, each other one with a badge for
// what is waiting there or a note that its sign-in has ended. Each is
// asked once, when the sheet opens.

export default function ServerSwitcher({ current }: { current?: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(theme);
  const router = useRouter();
  const { servers, switchTo } = useServers();
  const navigation = useNavigation<ServerNavigation>();
  const { waiting } = useWaiting(servers, current);

  // The sheet closes before the app moves on: a screen pushed from inside
  // a sheet would open inside it. Another server instead replaces the
  // screen under the sheet first, so the sheet closes onto it, swapped in
  // place. Replaced after, the old server went blank behind the closing
  // sheet. The server is put first only once the sheet is going, so the
  // list doesn't reorder in view.
  const open = (server: SavedServer) => {
    const ended = waiting[server.id]?.state === "ended";
    if (server.id !== current && !ended) {
      swapServer(navigation, server.id);
      router.back();
      switchTo(server.id);
      return;
    }
    router.back();
    if (ended) router.push({ pathname: "/sign-in", params: { server: server.origin } });
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
    </View>
  );
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
  });
}
