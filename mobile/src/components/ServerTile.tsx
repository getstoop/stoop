import { StyleSheet, Text, View } from "react-native";
import { type Theme, tokens, useTheme } from "../theme";

// A server's tile: its first letter. Dimmed for one signed out of.
// Hidden from screen readers: the name beside it says the same.
export default function ServerTile({ name, dim }: { name: string; dim?: boolean }) {
  const styles = makeStyles(useTheme());
  return (
    <View
      style={[styles.tile, dim && styles.dim]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={styles.letter}>{name.trim().charAt(0).toUpperCase()}</Text>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    tile: {
      width: 28,
      height: 28,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.accentSoft,
    },
    dim: {
      opacity: tokens.disabled,
    },
    letter: {
      color: theme.accent,
      fontSize: tokens.textUi,
      fontWeight: "700",
    },
  });
}
