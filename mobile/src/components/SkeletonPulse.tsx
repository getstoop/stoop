import { type ReactNode, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated } from "react-native";
import { PulseContext } from "./usePulse";

const PULSE_MS = 800;
// off-scale: the dim end of the pulse, not a disabled state.
const PULSE_LOW = 0.5;

// Sets the SkeletonBlocks under it pulsing gently, together, whatever
// else sits among them: a Skeleton does this for its own blocks, and a
// screen wraps this around more when a placeholder stands outside its
// Skeleton (a header's line beside real words). With Reduce Motion on
// the blocks are still.
export default function SkeletonPulse({ children }: { children: ReactNode }) {
  const opacity = useRef(new Animated.Value(1)).current;
  // Still until the setting is known.
  const [still, setStill] = useState(true);
  useEffect(() => {
    let gone = false;
    AccessibilityInfo.isReduceMotionEnabled().then(
      (reduced) => !gone && setStill(reduced),
      () => {},
    );
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setStill);
    return () => {
      gone = true;
      sub.remove();
    };
  }, []);
  useEffect(() => {
    if (still) {
      opacity.setValue(1);
      return;
    }
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: PULSE_LOW, duration: PULSE_MS, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: PULSE_MS, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [still, opacity]);

  return <PulseContext.Provider value={opacity}>{children}</PulseContext.Provider>;
}
