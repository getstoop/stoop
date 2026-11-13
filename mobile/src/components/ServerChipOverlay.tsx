import { StyleSheet, View } from "react-native";
import { SafeAreaInsetsContext, SafeAreaProvider } from "react-native-safe-area-context";
import { serverChipPlace, useServerChipShown } from "../hooks/useServerChipRoom";
import ServerChip from "./ServerChip";

// The server chip on an iOS before 26, where the tab bar is the
// system's, lies over the screen and has no slot for the chip: each
// tab's screen ends with this, which draws the chip over its foot, on
// top of the tab bar. The safe area is measured here, inside the tab,
// where it takes in the tab bar; the app's root provider knows only the
// window's. The screen's lists pad by the chip's height
// (hooks/useServerChipRoom.ts, which says where the chip goes
// elsewhere). Nothing where the tab bar carries the chip, and nothing
// with one server.
export default function ServerChipOverlay() {
  const shown = useServerChipShown();
  if (serverChipPlace !== "overlay" || !shown) return null;
  return (
    <SafeAreaProvider style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <SafeAreaInsetsContext.Consumer>
        {(insets) => (
          <View style={[styles.foot, { bottom: insets?.bottom ?? 0 }]}>
            <ServerChip />
          </View>
        )}
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
});
