import type { LoginProviderSummary } from "@stoop/gen/stoop/instance/v1/providers_pb";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { type Theme, tokens, useTheme } from "../../theme";

// "Continue with X" for each login provider the server has. The one
// whose browser round trip is under way shows it; the rest wait.
export default function ProviderButtons({
  providers,
  pending,
  disabled,
  onPress,
}: {
  providers: LoginProviderSummary[];
  pending: string | null;
  disabled: boolean;
  onPress: (id: string) => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);

  return (
    <View style={styles.list}>
      {providers.map((p) => (
        <Pressable
          key={p.id}
          accessibilityRole="button"
          accessibilityState={{ disabled, busy: pending === p.id }}
          disabled={disabled}
          onPress={() => onPress(p.id)}
          style={({ pressed }) => [
            styles.button,
            disabled && pending !== p.id && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          {pending === p.id && <ActivityIndicator color={theme.textMuted} />}
          <Text style={styles.label}>{p.displayName}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    list: {
      gap: 10,
    },
    button: {
      height: 48,
      flexDirection: "row",
      gap: 8,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: tokens.radiusMd,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.panel,
    },
    disabled: {
      opacity: tokens.disabled,
    },
    pressed: {
      opacity: 0.85,
    },
    label: {
      color: theme.text,
      fontSize: tokens.textBody,
      fontWeight: "600",
    },
  });
}
