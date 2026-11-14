import { useEffect } from "react";
import { AccessibilityInfo, Platform, StyleSheet, Text, View } from "react-native";
import { type Theme, tokens, useTheme } from "../../theme";

// A card that says why an invite can't be used, or couldn't be: what
// went wrong over what to do about it. Read out as it appears, and as
// its words change: the alert role alone says nothing while the focus
// is on the field or the button, so Android gets a live region and iOS
// is told.
export default function InviteNotice({ heading, body }: { heading: string; body: string }) {
  const styles = makeStyles(useTheme());
  useEffect(() => {
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(`${heading}. ${body}`);
  }, [heading, body]);
  return (
    <View style={styles.card} accessibilityRole="alert" accessibilityLiveRegion="assertive">
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
