import { isLiquidGlassAvailable } from "expo-glass-effect";
import { useEffect, useRef, useState } from "react";
import { Animated, Platform, StyleSheet } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useCallBarShown } from "../../call/CallProvider";
import { CALL_BAR_HEIGHT, callPillClearance } from "../../call/callBar";
import CallBarContent from "../../components/CallBarContent";
import { tokens } from "../../theme";
import Surface from "./Surface";

// A screen's call pill, as its screen holds it: whether it is drawn,
// whether its call is still on, its fade, and how far below the header
// it reaches.
export type CallPillState = {
  present: boolean;
  live: boolean;
  opacity: Animated.Value;
  clearance: number;
};

// The pill of a channel, a conversation or a thread. It fades in as a
// call starts and out as it ends, however it ends, and is `present`
// until it has faded: the screen's list gives its room back
// (`clearance`) only then, so no row slides under a pill still in
// sight. A call starting again meanwhile fades it back in. Under Reduce
// Motion it comes and goes at once. Changes only as the pill comes and
// goes, not as who is speaking does, so the screen is not drawn again
// for that.
export function useCallPill(): CallPillState {
  const live = useCallBarShown();
  const reduced = useReducedMotion();
  // A screen opened during a call has its pill from the start.
  const opacity = useRef(new Animated.Value(live ? 1 : 0)).current;
  const [present, setPresent] = useState(live);
  if (live && !present) setPresent(true);
  useEffect(() => {
    const fade = Animated.timing(opacity, {
      toValue: live ? 1 : 0,
      duration: reduced ? 0 : tokens.dur,
      useNativeDriver: true,
    });
    // A fade cut short by the next one decides nothing.
    fade.start(({ finished }) => {
      if (finished && !live) setPresent(false);
    });
    return () => fade.stop();
  }, [live, reduced, opacity]);
  return { present, live, opacity, clearance: callPillClearance(present) };
}

// The call bar on a channel, a conversation and a thread, which have no
// tab bar to carry it: a second floating row under the header
// (ScreenHeader), on the header's surface, while the app is in a call.
// What it says and does is the tabs' bar's (CallBarContent). While it
// fades out after its call it shows what it last said, takes no touches
// and is hidden from a screen reader. The screen holds its state
// (useCallPill) and clears it by that.
export default function CallPill({
  top,
  pill,
}: {
  // Where the pill starts: the header's reach.
  top: number;
  pill: CallPillState;
}) {
  const glass = Platform.OS === "ios" && isLiquidGlassAvailable();
  if (!pill.present) return null;
  return (
    <Animated.View
      style={[styles.row, { top, opacity: pill.opacity }]}
      pointerEvents={pill.live ? "box-none" : "none"}
      accessibilityElementsHidden={!pill.live}
      importantForAccessibility={pill.live ? "auto" : "no-hide-descendants"}
    >
      <Surface glass={glass} style={styles.pill}>
        <CallBarContent held />
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
