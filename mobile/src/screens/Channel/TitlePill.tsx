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
// there are). Neither platform's bar says how much room that is: iOS
// hands a title only the room it asks for, and Android's row starts
// after the back button but is as wide as the bar chooses (wider than
// the screen has left, with no button at the right). So the pill is
// given its width: the window's, less what the bar keeps at each side.
// On Android it starts where its row does.
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
      : { width: width - (ios ? BACK_KEPT : ANDROID_BACK_KEPT) - beside * (ios ? BUTTON_KEPT : ANDROID_BUTTON_KEPT) };
  return (
    <View style={[styles.row, !ios && fill && styles.fromStart]}>
      <Surface glass={glass} style={{ ...styles.pill, ...fill, ...(lead !== undefined && { paddingLeft: lead }) }}>
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
// each button at the right takes there (its 44 and a gap).
const BACK_KEPT = 96;
const BUTTON_KEPT = 56;
// Android's: the back button's 56 and the screen's far inset, and each
// button at the right's 44 with the gap the bar leaves before it.
const ANDROID_BACK_KEPT = 72;
const ANDROID_BUTTON_KEPT = 60;

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "center",
  },
  fromStart: {
    justifyContent: "flex-start",
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
