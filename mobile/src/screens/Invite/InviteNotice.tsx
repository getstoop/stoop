import { StyleSheet, Text, View } from "react-native";
import { type Theme, tokens, useTheme } from "../../theme";

// A card that says why an invite can't be used, or couldn't be: what
// went wrong over what to do about it. Read out as it appears. "plain"
// is for something to know that isn't a failure.
export default function InviteNotice({
  heading,
  body,
  tone = "danger",
}: {
  heading: string;
  body: string;
  tone?: "danger" | "plain";
}) {
  const styles = makeStyles(useTheme());
  return (
    <View style={[styles.card, tone === "danger" && styles.danger]} accessibilityRole="alert">
      <Text style={styles.heading}>{heading}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    card: {
      padding: 16,
      gap: 6,
      borderRadius: tokens.radiusLg,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.panel,
    },
    danger: {
      borderColor: theme.danger,
      backgroundColor: theme.dangerSoft,
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
  });
}
