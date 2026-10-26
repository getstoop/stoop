import { type ReactNode, useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { tokens } from "../../theme";

// The viewer's pages side by side, a sideways swipe from one to the
// next. Its own pan rather than a paging list: on Android a native list
// and the pages' gestures (zoom, drag down, taps) don't share a touch,
// and the list never pages. A swipe a quarter of the way, or a fling,
// goes on (onIndex); less springs back, and either end gives a little.
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
  // Where the row is, in pages, and how far a finger has pulled it.
  const at = useSharedValue(index);
  const pull = useSharedValue(0);
  // The page this pager last moved to, so an `index` it reported itself
  // doesn't start the slide again.
  const reached = useRef(index);

  useEffect(() => {
    if (index === reached.current) return;
    reached.current = index;
    at.value = withTiming(index, { duration: tokens.dur });
  }, [index, at]);

  const settled = (next: number) => {
    reached.current = next;
    onIndex(next);
  };

  const pan = usePanGesture({
    enabled,
    maxPointers: 1,
    activeOffsetX: [-12, 12],
    failOffsetY: [-12, 12],
    onUpdate: (event) => {
      const from = Math.round(at.value);
      const pastEdge = (from === 0 && event.translationX > 0) || (from === count - 1 && event.translationX < 0);
      pull.value = pastEdge ? event.translationX / 3 : event.translationX;
    },
    onDeactivate: (event) => {
      const from = Math.round(at.value);
      let next = from;
      if (event.translationX < -width / 4 || event.velocityX < -FLING) next = from + 1;
      else if (event.translationX > width / 4 || event.velocityX > FLING) next = from - 1;
      next = Math.max(0, Math.min(count - 1, next));
      // The pull folds into the position, so the row slides on from
      // where the finger left it.
      at.value = from - pull.value / width;
      pull.value = 0;
      at.value = withTiming(next, { duration: tokens.dur });
      if (next !== from) scheduleOnRN(settled, next);
    },
  });

  const row = useAnimatedStyle(() => ({
    transform: [{ translateX: -at.value * width + pull.value }],
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
