import { StyleSheet, Text, View } from "react-native";
import { hostOf } from "../../api/probe";
import { type Theme, tokens, useTheme } from "../../theme";

// Which server this sign-in is for, in the header: its first letter and
// its address.
export default function ServerPill({ origin, name }: { origin: string; name: string }) {
  const theme = useTheme();
  const styles = makeStyles(theme);

  return (
    <View style={styles.pill} accessible accessibilityLabel={`Server ${hostOf(origin)}`}>
      <View style={styles.tile}>
        <Text style={styles.letter}>{name.trim().charAt(0).toUpperCase()}</Text>
      </View>
      <Text style={styles.host} numberOfLines={1}>
        {hostOf(origin)}
      </Text>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    pill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      maxWidth: 240,
      paddingVertical: 4,
      paddingLeft: 4,
      paddingRight: 12,
      borderRadius: tokens.radiusPill,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.panel,
    },
    tile: {
      width: 24,
      height: 24,
      borderRadius: tokens.radius,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.accentSoft,
    },
    letter: {
      color: theme.accent,
      fontSize: tokens.textSm,
      fontWeight: "700",
    },
    host: {
      flexShrink: 1,
      color: theme.textMuted,
      fontSize: tokens.textUi,
    },
  });
}
