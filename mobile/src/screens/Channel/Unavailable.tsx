import { Pressable, StyleSheet, Text, View } from "react-native";
import { type Theme, tokens, useTheme } from "../../theme";

// What a channel or a thread screen says in place of its messages when it
// can't show them, with the one thing to do about it, if any.
export default function Unavailable({
  message,
  action,
}: {
  message: string;
  action?: { label: string; onPress: () => void };
}) {
  const styles = makeStyles(useTheme());
  return (
    <View style={styles.screen}>
      <View style={styles.notice} accessibilityRole="alert">
        <Text style={styles.body}>{message}</Text>
        {action && (
          <Pressable
            accessibilityRole="button"
            onPress={action.onPress}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          >
            <Text style={styles.buttonLabel}>{action.label}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.surface,
    },
    notice: {
      gap: 12,
      marginTop: 8,
      paddingHorizontal: 20,
    },
    body: {
      color: theme.text,
      fontSize: tokens.textBody,
      lineHeight: tokens.textBody * tokens.leadingBody,
    },
    button: {
      height: 50,
      borderRadius: tokens.radiusMd,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.accent,
    },
    pressed: {
      opacity: 0.85,
    },
    buttonLabel: {
      color: theme.onAccent,
      fontSize: tokens.textBody,
      fontWeight: "600",
    },
  });
}
