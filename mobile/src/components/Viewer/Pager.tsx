import { type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { GestureDetector, type PanGestureConfig, usePanGesture } from "react-native-gesture-handler";
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { tokens } from "../../theme";

// The viewer's pages side by side, a sideways swipe from one to the
// next. Its own pan rather than a paging list: on Android a native list
// and the pages' gestures (zoom, drag down, taps) don't share a touch,
// and the list never pages. A fling goes the way it is flung, a slow
// swipe a quarter of the way goes on (onIndex), less springs back, and
// either end gives a little. A swipe cut short (a second finger) springs
// back.
// An `index` set from outside (a screen reader's step) slides there.
// Only the page shown and its neighbours are drawn. Off while a page is
// zoomed (`enabled`), when a drag pans the picture instead.

// How fast a fling must be to page, in points a second.
const FLING = 500;

export default function Pager({
  count,
  index,
  width,
  height,
  enabled,
  keyOf,
  renderPage,
  onIndex,
}: {
  count: number;
  index: number;
  width: number;
  height: number;
  enabled: boolean;
  keyOf: (at: number) => string;
  renderPage: (at: number) => ReactNode;
  onIndex: (at: number) => void;
}) {
  // Where the row is, in pages (between two while it moves), and the
  // page it is headed for.
  const at = useSharedValue(index);
  const target = useSharedValue(index);
  // Where the row was when the finger came down.
  const grabbed = useSharedValue(index);
  // The page this pager last moved to, so an `index` it reported itself
  // doesn't start the slide again.
  const reached = useRef(index);

  useEffect(() => {
    if (index === reached.current) return;
    reached.current = index;
    target.value = index;
    at.value = withTiming(index, { duration: tokens.dur });
  }, [index, at, target]);

  const report = useRef(onIndex);
  report.current = onIndex;
  const settled = useCallback((next: number) => {
    reached.current = next;
    report.current(next);
  }, []);

  // The same config while nothing it reads changes: a new one goes to
  // the native handler, and a swipe begun as the last one's page
  // reports itself would be dropped with the old. Built outside the
  // hook, so its callbacks say they are worklets themselves.
  const config = useMemo((): PanGestureConfig => {
    // Where a finger's pull puts the row; past either end it gives a little.
    const pulled = (translationX: number) => {
      "worklet";
      const raw = grabbed.value - translationX / width;
      const last = count - 1;
      return raw < 0 ? raw / 3 : raw > last ? last + (raw - last) / 3 : raw;
    };
    return {
      enabled,
      maxPointers: 1,
      activeOffsetX: [-12, 12],
      failOffsetY: [-12, 12],
      onActivate: () => {
        "worklet";
        // A swipe during the last one's slide takes the row from where it is.
        cancelAnimation(at);
        grabbed.value = at.value;
      },
      onUpdate: (event) => {
        "worklet";
        at.value = pulled(event.translationX);
      },
      onDeactivate: (event) => {
        "worklet";
        const from = target.value;
        // From the release's own translation: a quick swipe may end
        // with no update after its activation.
        if (!event.canceled) at.value = pulled(event.translationX);
        let next = from;
        if (!event.canceled) {
          // A fling goes the way it is flung, from the page the row is
          // headed for; a slow release a quarter past it goes on.
          if (event.velocityX < -FLING) next = Math.max(from, Math.floor(at.value)) + 1;
          else if (event.velocityX > FLING) next = Math.min(from, Math.ceil(at.value)) - 1;
          else if (at.value - from > 0.25) next = from + 1;
          else if (at.value - from < -0.25) next = from - 1;
        }
        next = Math.max(0, Math.min(count - 1, next));
        target.value = next;
        at.value = withTiming(next, { duration: tokens.dur });
        if (next !== from) scheduleOnRN(settled, next);
      },
    };
  }, [enabled, count, width, at, target, grabbed, settled]);
  const pan = usePanGesture(config);

  const row = useAnimatedStyle(() => ({
    transform: [{ translateX: -at.value * width }],
  }));

  const drawn = [index - 1, index, index + 1].filter((page) => page >= 0 && page < count);
  return (
    <GestureDetector gesture={pan}>
      <View style={[styles.frame, { width, height }]}>
        <Animated.View style={[StyleSheet.absoluteFill, row]}>
          {drawn.map((page) => (
            <View key={keyOf(page)} style={[styles.page, { left: page * width, width, height }]}>
              {renderPage(page)}
            </View>
          ))}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: "hidden",
  },
  page: {
    position: "absolute",
    top: 0,
  },
});
