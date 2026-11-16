import { StyleSheet, View } from "react-native";
import { SafeAreaInsetsContext, SafeAreaProvider } from "react-native-safe-area-context";
import { CALL_BAR_HEIGHT } from "../call/callBar";
import { CALL_BAR_FLOAT_GAP, serverChipPlace, useTabRow } from "../hooks/useServerChipRoom";
import Surface from "../screens/Channel/Surface";
import CallBar from "./CallBar";
import CallBarContent from "./CallBarContent";
import ServerChip from "./ServerChip";

// The row by the tab bar on iOS, where the tab bar is the system's and
// lies over the screen: each tab's screen ends with this, which draws
// the row over its foot, on top of the tab bar. The safe area is
// measured here, inside the tab, where it takes in the tab bar; the
// app's root provider knows only the window's. The screen's lists pad
// by the row's height (hooks/useServerChipRoom.ts, which says where the
// row goes elsewhere).
// Before iOS 26 the row is the server chip, or the call bar in its
// place while in a call. From iOS 26 the chip is in the tab bar's own
// slot and this draws only the call bar, which has no drawing for the
// slot yet: a bubble of Liquid Glass floating over the tab bar, where
// the slot, emptied meanwhile, was. Nothing on Android, whose tab bar
// carries the row, and nothing with no row.
export default function TabRowOverlay() {
  const row = useTabRow();
  const floating = serverChipPlace === "slot";
  if (serverChipPlace === "bar" || !row || (floating && row === "chip")) return null;
  return (
    <SafeAreaProvider style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <SafeAreaInsetsContext.Consumer>
        {(insets) =>
          floating ? (
            <View style={[styles.foot, styles.floating, { bottom: (insets?.bottom ?? 0) + CALL_BAR_FLOAT_GAP }]}>
              <Surface glass style={styles.bubble}>
                <CallBarContent />
              </Surface>
            </View>
          ) : (
            <View style={[styles.foot, { bottom: insets?.bottom ?? 0 }]}>
              {row === "call" ? <CallBar /> : <ServerChip />}
            </View>
          )
        }
      </SafeAreaInsetsContext.Consumer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  foot: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  // As far from the sides as the system's tab bar is.
  floating: {
    paddingHorizontal: 20,
  },
  bubble: {
    borderRadius: CALL_BAR_HEIGHT / 2,
  },
});
