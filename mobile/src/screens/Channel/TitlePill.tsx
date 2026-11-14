import { isLiquidGlassAvailable } from "expo-glass-effect";
import type { ReactNode } from "react";
import { Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import { tokens } from "../../theme";
import Surface from "./Surface";

// The header's title as a pill floating over the list, as the composer
// floats over its foot and the back button over its head: Liquid Glass
// where iOS has it, else the composer's panel. The channel's and the
// thread's titles sit in one, their lines starting at the left. Android
// hands the title a row of the bar, so the pill is a row's child.
// The thread's is as wide as its words, in the middle.
//
// The channel's and a conversation's fill the row between the back
// button and the buttons at the right instead (`beside`, how many
// there are). iOS hands a title only the room it asks for, so there the
// pill is given its width: the window's, less what the bar keeps at
// each side. Android's row starts after the back button and is as wide
// as what is in it asks for, up to the bar's own idea of its room, so
// there the pill grows to fill it and a margin stops it short: of the
// buttons at the right, under which the row runs, or, with none, of the
// screen's edge, which the row then runs past.
//
// `lead` is the pill's padding at the left, for a title that starts
// with a face (ConversationTitle), which sits nearer the pill's end
// than words do.
export default function TitlePill({
  label,
  beside,
  lead,
  children,
}: {
  label: string;
  beside?: number;
  lead?: number;
  children: ReactNode;
}) {
  const ios = Platform.OS === "ios";
  const glass = ios && isLiquidGlassAvailable();
  const { width } = useWindowDimensions();
  const fill =
    beside === undefined
      ? undefined
      : ios
        ? { width: width - BACK_KEPT - beside * BUTTON_KEPT }
        : { flexGrow: 1, marginRight: beside === 0 ? ANDROID_PAST_EDGE : beside * BUTTON_KEPT };
  return (
    <View style={styles.row}>
      <Surface glass={glass} flat={!ios} style={{ ...styles.pill, ...fill, ...(lead !== undefined && { paddingLeft: lead }) }}>
        <View style={styles.title} accessible accessibilityRole="header" accessibilityLabel={label}>
          {children}
        </View>
      </Surface>
    </View>
  );
}

// What iOS's bar keeps for the back button and the screen's far inset
// (the button's inset, its 44 and a gap, the inset, and a little to
// spare: a title wider than the bar's room for it is cut off), and what
// each button at the right takes on either platform (its 44 and a gap).
const BACK_KEPT = 96;
const BUTTON_KEPT = 56;
// How far Android's row runs past the screen's edge with no button at
// the right (24: the bar counts its room from its 16 insets, and puts
// the row after the back button's 56), and the 16 the pill keeps from
// that edge.
const ANDROID_PAST_EDGE = 40;

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
