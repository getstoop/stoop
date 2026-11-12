import { ScrollView, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type Theme, tokens, useTheme } from "../../theme";
import AlertKindsSection from "./AlertKindsSection";
import DoNotDisturbCard from "./DoNotDisturbCard";

// What this phone is alerted about, for every server on it: one section
// under the next. Do not disturb is the first, then which kinds alert.
export default function NotificationSettings() {
  const insets = useSafeAreaInsets();
  const styles = makeStyles(useTheme());
  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 16 }]}>
      <Text style={styles.title} accessibilityRole="header">
        Notifications
      </Text>
      <DoNotDisturbCard />
      <AlertKindsSection />
    </ScrollView>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.surface,
    },
    content: {
      gap: 18,
      paddingTop: 8,
      paddingHorizontal: 16,
    },
    // As the Theme screen's, which sits in a list eight in from the edge.
    title: {
      marginHorizontal: 8,
      color: theme.text,
      fontSize: tokens.textXl,
      lineHeight: tokens.textXl * tokens.leadingTight,
      fontWeight: "700",
    },
  });
}
