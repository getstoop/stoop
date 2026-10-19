import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { hostOf } from "../../api/probe";
import { type Theme, tokens, useTheme } from "../../theme";

// What sign-in shows before it has a form to offer: the server's status
// still loading, the server out of reach, or a server whose first
// account hasn't been made yet (that happens in a browser).
export type Notice = "loading" | "unreachable" | "needs-setup";

export default function StatusNotice({
  notice,
  origin,
  name,
  onRetry,
}: {
  notice: Notice;
  origin: string;
  name: string;
  onRetry: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const host = hostOf(origin);

  if (notice === "loading") return <ActivityIndicator color={theme.textMuted} />;

  if (notice === "unreachable") {
    return (
      <View style={styles.notice} accessibilityRole="alert">
        <Text style={styles.heading}>Can't reach {host}</Text>
        <Text style={styles.body}>
          Check that this phone is on a network that can reach the server.
        </Text>
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}>
          <Text style={styles.retryLabel}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.notice} accessibilityRole="alert">
      <Text style={styles.heading}>{name} isn't set up yet</Text>
      <Text style={styles.body}>
        Its first account is made in a browser. Open {host} there to finish setting it up, then
        come back to sign in.
      </Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}>
        <Text style={styles.retryLabel}>Check again</Text>
      </Pressable>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    notice: {
      padding: 16,
      gap: 8,
      borderRadius: tokens.radiusLg,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.panel,
    },
    heading: {
      color: theme.text,
      fontSize: tokens.textBody,
      fontWeight: "600",
    },
    body: {
      color: theme.text,
      fontSize: tokens.textUi,
      lineHeight: tokens.textUi * tokens.leadingUi,
    },
    retry: {
      marginTop: 4,
      height: 44,
      borderRadius: tokens.radiusMd,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.raised,
    },
    retryLabel: {
      color: theme.text,
      fontSize: tokens.textBody,
      fontWeight: "600",
    },
  });
}
