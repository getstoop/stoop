import { StyleSheet, Text, View } from "react-native";
import { type Theme, tokens, useTheme } from "../../theme";

// A card that says why an invite can't be used, or couldn't be: what
// went wrong over what to do about it. Read out as it appears.
export default function InviteNotice({ heading, body }: { heading: string; body: string }) {
  const styles = makeStyles(useTheme());
  return (
    <View style={styles.card} accessibilityRole="alert">
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
