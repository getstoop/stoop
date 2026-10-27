import { isLiquidGlassAvailable } from "expo-glass-effect";
import type { ReactNode } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { tokens } from "../../theme";
import Surface from "./Surface";

// The header's title as a pill floating over the list, as the composer
// floats over its foot and the back button over its head: Liquid Glass
// where iOS has it, else the composer's panel. The channel's and the
// thread's titles sit in one, their lines starting at the left. Android
// hands the title the bar's whole width, so the pill is a row's child,
// as wide as its words, in the middle.
export default function TitlePill({ label, children }: { label: string; children: ReactNode }) {
  const glass = Platform.OS === "ios" && isLiquidGlassAvailable();
  return (
    <View style={styles.row}>
      <Surface glass={glass} style={styles.pill}>
        <View style={styles.title} accessible accessibilityRole="header" accessibilityLabel={label}>
          {children}
        </View>
      </Surface>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "center",
  },
  pill: {
    flexShrink: 1,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderRadius: tokens.radiusPill,
    justifyContent: "center",
  },
  title: {
    alignItems: "flex-start",
    gap: 1,
  },
});
