import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { SavedServer } from "../servers";
import { type Theme, tokens, useTheme } from "../theme";
import { ChevronDownIcon } from "./Icons";

// The top of a server's tabs (Spaces, Activity): the server's tile and
// name with a chevron, opening the server switcher over it.
export default function ServerHeader({ server }: { server: SavedServer }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const router = useRouter();

  return (
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
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
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
    pressed: {
      opacity: 0.85,
    },
  });
}
