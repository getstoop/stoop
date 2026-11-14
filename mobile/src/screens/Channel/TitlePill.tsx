import { isLiquidGlassAvailable } from "expo-glass-effect";
import type { ReactNode } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { tokens } from "../../theme";
import Surface from "./Surface";

// The header's title as a pill, between the back button and the
// header's capsule (ScreenHeader): Liquid Glass where iOS has it, else
// the composer's panel. The channel's, a conversation's and the
// thread's titles sit in one, their lines starting at the left, and it
// takes all the room the header's row leaves it.
//
// `lead` is the pill's padding at the left, for a title that starts
// with a face (ConversationTitle), which sits nearer the pill's end
// than words do.
export default function TitlePill({
  label,
  lead,
  children,
}: {
  label: string;
  lead?: number;
  children: ReactNode;
}) {
  const glass = Platform.OS === "ios" && isLiquidGlassAvailable();
  return (
    <Surface glass={glass} style={{ ...styles.pill, ...(lead !== undefined && { paddingLeft: lead }) }}>
      <View style={styles.title} accessible accessibilityRole="header" accessibilityLabel={label}>
        {children}
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  pill: {
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
