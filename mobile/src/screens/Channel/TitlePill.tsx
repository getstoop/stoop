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
// How far the title's words grow with the system's text size (their
// `maxFontSizeMultiplier`). The header is one bar's height and the list
// clears it by a set amount (ScreenHeader), with 12 points to spare:
// up to here the pill grows into that, and past it would cover the
// list's first rows. A navigation bar's own title doesn't grow at all.
export const TITLE_SCALE = 1.3;

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
