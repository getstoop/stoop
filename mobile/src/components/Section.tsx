import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { type Theme, tokens, useTheme } from "../theme";

// A titled group of rows, on the You tab and the Notifications screen.
export default function Section({ title, children }: { title: string; children: ReactNode }) {
  const styles = makeStyles(useTheme());
  return (
    <View style={styles.section}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.group}>{children}</View>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    section: {
      gap: 6,
    },
    title: {
      marginHorizontal: 4,
      color: theme.textMuted,
      fontSize: tokens.textXs,
      fontWeight: "600",
      letterSpacing: 0.6,
      textTransform: "uppercase",
    },
    group: {
      borderRadius: tokens.radiusLg,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.panel,
      overflow: "hidden",
    },
  });
}
