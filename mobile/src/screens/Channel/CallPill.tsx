import { isLiquidGlassAvailable } from "expo-glass-effect";
import { useEffect, useRef } from "react";
import { Animated, Platform, StyleSheet } from "react-native";
import { useCall } from "../../call/CallProvider";
import { CALL_BAR_HEIGHT, callBarShown, callPillClearance } from "../../call/callBar";
import CallBarContent from "../../components/CallBarContent";
import { tokens } from "../../theme";
import Surface from "./Surface";

// How far below its header a screen's call pill reaches: nothing with
// no call.
export function useCallPillClearance(): number {
  return callPillClearance(useCall());
}

// The call bar on a channel, a conversation and a thread, which have no
// tab bar to carry it: a second floating row under the header
// (ScreenHeader), on the header's surface, while the app is in a call.
// What it says and does is the tabs' bar's (CallBarContent). It fades
// in as a call starts and goes at once when it ends; the screen's list
// clears it by useCallPillClearance.
export default function CallPill({
  top,
}: {
  // Where the pill starts: the header's clearance.
  top: number;
}) {
  const shown = callBarShown(useCall());
  const glass = Platform.OS === "ios" && isLiquidGlassAvailable();
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!shown) {
      opacity.setValue(0);
      return;
    }
    Animated.timing(opacity, { toValue: 1, duration: tokens.dur, useNativeDriver: true }).start();
  }, [shown, opacity]);
  if (!shown) return null;
  return (
    <Animated.View style={[styles.row, { top, opacity }]} pointerEvents="box-none">
      <Surface glass={glass} style={styles.pill}>
        <CallBarContent />
      </Surface>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    position: "absolute",
    left: 0,
    right: 0,
    // Over the list and its edges, as the header is.
    zIndex: 1,
    paddingHorizontal: 16,
  },
  pill: {
    borderRadius: CALL_BAR_HEIGHT / 2,
  },
});
