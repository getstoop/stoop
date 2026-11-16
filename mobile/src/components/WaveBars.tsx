import { StyleSheet, View } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";

// The sound wave of a call going on, as five bars (the shape of the
// Call | Chat switch's WaveMark) that can move: while `moving`, each
// eases shorter and back, out of step with the others, for as long as
// it is drawn. It follows no sound: it says only that the call is on.
// Still otherwise, and under Reduce Motion. The motion is the animation
// library's own, off the JavaScript thread, and nothing is drawn again
// for it. Decorative: what it means is said beside it.
export default function WaveBars({ color, size = 18, moving }: { color: string; size?: number; moving: boolean }) {
  const reduced = useReducedMotion();
  const unit = size / 24;
  const width = STROKE * unit;
  return (
    <View style={{ width: size, height: size }}>
      {BARS.map((bar) => {
        const height = (bar.length + STROKE) * unit;
        return (
          <Animated.View
            key={bar.x}
            style={[
              styles.bar,
              {
                left: bar.x * unit - width / 2,
                top: (size - height) / 2,
                width,
                height,
                borderRadius: width / 2,
                backgroundColor: color,
              },
              moving && !reduced && { ...SWAY, animationDuration: bar.ms },
            ]}
          />
        );
      })}
    </View>
  );
}

// The icon's stroke, and its bars: where each stands and how long it
// is, in the icon's 24-point box, and how long one way of its sway
// takes. The times differ so that the bars keep no step.
const STROKE = 2.2;
const BARS = [
  { x: 5, length: 4, ms: 620 },
  { x: 9, length: 12, ms: 780 },
  { x: 13, length: 6, ms: 540 },
  { x: 17, length: 16, ms: 860 },
  { x: 21, length: 4, ms: 700 },
];

// Down to under half its length and back, about its middle, for good.
const SWAY = {
  animationName: { from: { transform: [{ scaleY: 1 }] }, to: { transform: [{ scaleY: 0.45 }] } },
  animationIterationCount: "infinite",
  animationDirection: "alternate",
  animationTimingFunction: "ease-in-out",
} as const;

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
  },
});
