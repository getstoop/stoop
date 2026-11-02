import { Pressable, StyleSheet, Text } from "react-native";
import { type Theme, tokens, useTheme } from "../../theme";

// In place of the spinner at a list's edge when the page asked for there
// failed: says so, and a tap asks again.
export default function PageRetry({ onPress }: { onPress: () => void }) {
  const styles = makeStyles(useTheme());
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Text style={styles.label}>Couldn't load, tap to retry</Text>
    </Pressable>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    row: {
      alignItems: "center",
      paddingVertical: 16,
    },
    pressed: {
      opacity: 0.6,
    },
    label: {
      color: theme.textMuted,
      fontSize: tokens.textUi,
    },
  });
}
