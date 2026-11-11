import { isLiquidGlassAvailable } from "expo-glass-effect";
import type { ReactNode } from "react";
import { Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import { tokens } from "../../theme";
import Surface from "./Surface";

// The header's title as a pill floating over the list, as the composer
// floats over its foot and the back button over its head: Liquid Glass
// where iOS has it, else the composer's panel. The channel's and the
// thread's titles sit in one, their lines starting at the left. Android
// hands the title the bar's whole width, so the pill is a row's child.
// The thread's is as wide as its words, in the middle.
//
// The channel's and a conversation's fill the row between the back
// button and the buttons at the right instead (`beside`, how many
// there are). Android's row
// runs from the back button to the screen's inset, under those buttons,
// so the pill grows to fill it and stops short of them; iOS hands a
// title only the room it asks for, so there the pill is given its
// width: the window's, less what the bar keeps at each side.
export default function TitlePill({
  label,
  beside,
  children,
}: {
  label: string;
  beside?: number;
  children: ReactNode;
}) {
  const glass = Platform.OS === "ios" && isLiquidGlassAvailable();
  const { width } = useWindowDimensions();
  const fill =
    beside === undefined
      ? undefined
      : Platform.OS === "ios"
        ? { width: width - BACK_KEPT - beside * BUTTON_KEPT }
        : { flexGrow: 1, marginRight: beside * BUTTON_KEPT };
  return (
    <View style={styles.row}>
      <Surface glass={glass} style={{ ...styles.pill, ...fill }}>
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
