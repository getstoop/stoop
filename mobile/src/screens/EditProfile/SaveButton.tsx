import { Pressable, StyleSheet, Text } from "react-native";
import { type Theme, tokens, useTheme } from "../../theme";
import type { SaveProps } from "./saveProps";

// Save in Android's header; iOS has its own bar button (saveItem).
export default function SaveButton({ label, disabled, onPress }: SaveProps) {
  const styles = makeStyles(useTheme());
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Text style={[styles.label, disabled && styles.disabled]}>{label}</Text>
    </Pressable>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    button: {
      minWidth: 44,
      height: 44,
      paddingHorizontal: 8,
      alignItems: "center",
      justifyContent: "center",
    },
    pressed: {
      opacity: 0.7,
    },
    label: {
      color: theme.accent,
      fontSize: tokens.textBody,
      fontWeight: "700",
    },
    disabled: {
      color: theme.textMuted,
      fontWeight: "600",
    },
  });
}
