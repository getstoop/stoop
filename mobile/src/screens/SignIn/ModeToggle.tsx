import { Pressable, StyleSheet, Text, View } from "react-native";
import { type Theme, tokens, useTheme } from "../../theme";

export type Mode = "sign-in" | "create";

const LABELS: Record<Mode, string> = { "sign-in": "Sign in", create: "Create account" };

// Sign in or create an account, for a server that takes new accounts
// without an invite. Only shown there.
export default function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const theme = useTheme();
  const styles = makeStyles(theme);

  return (
    <View style={styles.track} accessibilityRole="tablist">
      {(["sign-in", "create"] as const).map((m) => (
        <Pressable
          key={m}
          accessibilityRole="tab"
          accessibilityState={{ selected: mode === m }}
          onPress={() => onChange(m)}
          style={[styles.option, mode === m && styles.selected]}
        >
          <Text style={[styles.label, mode === m && styles.selectedLabel]}>{LABELS[m]}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    track: {
      flexDirection: "row",
      padding: 3,
      borderRadius: tokens.radiusMd,
      backgroundColor: theme.raised,
    },
    option: {
      flex: 1,
      height: 38,
      borderRadius: tokens.radius,
      alignItems: "center",
      justifyContent: "center",
    },
    selected: {
      backgroundColor: theme.panel,
    },
    label: {
      color: theme.textMuted,
      fontSize: tokens.textUi,
      fontWeight: "600",
    },
    selectedLabel: {
      color: theme.text,
    },
  });
}
