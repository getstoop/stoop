import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { type Theme, tokens, useTheme } from "../../theme";

// Shown while the system's notification permission is refused: nothing
// shows until it is allowed in the app's page in the system's settings,
// where this opens. The app never asks again from here.
export default function RefusedNotice() {
  const styles = makeStyles(useTheme());
  return (
    <View style={styles.card}>
      <View style={styles.text}>
        <Text style={styles.title} accessibilityRole="header">
          Notifications are off
        </Text>
        <Text style={styles.detail}>Allow them in Settings.</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        testID="notifications-open-settings"
        onPress={() => void Linking.openSettings().catch(() => {})}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Text style={styles.label}>Settings</Text>
      </Pressable>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: tokens.radiusLg,
      borderWidth: 1,
      borderColor: theme.warn,
      backgroundColor: theme.panel,
    },
    text: {
      flex: 1,
      gap: 2,
    },
    title: {
      color: theme.text,
      fontSize: tokens.textBody,
      fontWeight: "600",
    },
    detail: {
      color: theme.textMuted,
      fontSize: tokens.textUi,
    },
    // 44 high to tap.
    button: {
      justifyContent: "center",
      height: 44,
      paddingHorizontal: 14,
      borderRadius: 10,
      backgroundColor: theme.accent,
    },
    pressed: {
      opacity: 0.85,
    },
    label: {
      color: theme.onAccent,
      fontSize: tokens.textUi,
      fontWeight: "600",
    },
  });
}
