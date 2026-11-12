import { type ReactNode, useEffect, useRef } from "react";
import { Animated, type StyleProp, type ViewStyle } from "react-native";

const PULSE_MS = 800;
// off-scale: the dim end of the pulse, not a disabled state.
const PULSE_LOW = 0.5;

// A region standing in for content still loading: SkeletonBlocks laid
// out as the content will be, pulsing gently together. It reads as one
// thing, "Loading", to a screen reader, with its blocks hidden.
export default function Skeleton({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: PULSE_LOW, duration: PULSE_MS, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: PULSE_MS, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [opacity]);

  return (
    <Animated.View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      style={[style, { opacity }]}
    >
      {children}
    </Animated.View>
  );
}
