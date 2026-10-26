import { Image, type ImageLoadEventData } from "expo-image";
import { type ComponentRef, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from "react-native";
import {
  GestureDetector,
  GestureStateManager,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from "react-native-gesture-handler";
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { fileSource } from "../../api/files";
import { tokens } from "../../theme";
import { PhotoIcon } from "../Icons";
import type { ViewerItem } from "./items";

// One picture in the viewer, shrunk to fit the screen and never
// enlarged, as web's preview draws it, its thumbnail drawn in the same
// box until the original lands. Only the page on screen (`active`)
// decodes the original at full size, so a zoom stays sharp, and only
// when it is small enough to; its neighbours decode at the screen's
// size. Pinch zooms about the fingers, a double tap zooms in on that
// spot or back out, and while zoomed a drag pans it
// (the pager doesn't page then: onZoom). Unzoomed, a drag down follows
// the finger (`drag`, which the viewer shrinks and fades by) and closes
// it when far or fast enough (onSwipeClose), or springs back. A single
// tap is the viewer's (onTap). For a screen reader the page is one
// adjustable element whose increment and decrement page (onStep).

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
// The most pixels decoded whole: Android refuses to draw a bitmap over
// about 100 MB (26 MP), and a 48 MP photo whole is a memory risk on iOS.
const FULL_SIZE_PIXELS = 16_000_000;
// The longest gap between a double tap's taps, in ms: the library's
// default (200) misses many, the simulator's included.
const DOUBLE_TAP_DELAY = 300;
// How far a finger may move and still tap: further is a swipe, which
// Android otherwise counts as a tap too, and the pager never pages.
const TAP_SLOP = 10;
// A double tap's second tap is measured from the first's touch-down,
// and a thumb's two taps seldom land on one point.
const DOUBLE_TAP_SLOP = 40;
// How far, or how fast, a drag down must go to close the viewer.
const CLOSE_DY = 120;
const CLOSE_VY = 800;
const SPRING = { damping: 20, stiffness: 220 };

export default function Page({
  item,
  origin,
  token,
  width,
  height,
  active,
  label,
  takeFocus,
  drag,
  onTap,
  onZoom,
  onSwipeClose,
  onStep,
}: {
  item: ViewerItem;
  origin: string;
  token: string;
  width: number;
  height: number;
  active: boolean;
  label: string;
  // Whether a screen reader's focus should come here now; true once per
  // request (the viewer's opening, a step).
  takeFocus: () => boolean;
  drag: { x: SharedValue<number>; y: SharedValue<number> };
  onTap: () => void;
  onZoom: (zoomed: boolean) => void;
  onSwipeClose: () => void;
  onStep: (delta: number) => void;
}) {
  const { attachment } = item;
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const page = useRef<ComponentRef<typeof View>>(null);

  // The picture's own size, for how far a zoomed one may pan: the
  // server's, until the original says.
  const natural = useSharedValue({ width: attachment.width, height: attachment.height });
  const scale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const start = useSharedValue({ scale: 1, x: 0, y: 0, focalX: 0, focalY: 0 });

  const zoomTo = (next: boolean) => {
    setZoomed(next);
    onZoom(next);
  };

  // A page paged away from is drawn unzoomed when it comes back.
  useEffect(() => {
    if (active) return;
    scale.value = 1;
    x.value = 0;
    y.value = 0;
    setZoomed(false);
  }, [active, scale, x, y]);

  // Asked when the focus would move, so a redraw meanwhile doesn't use
  // the request up.
  const focusRequest = useRef(takeFocus);
  focusRequest.current = takeFocus;
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => {
      if (page.current && focusRequest.current()) AccessibilityInfo.sendAccessibilityEvent(page.current, "focus");
    }, 300);
    return () => clearTimeout(timer);
  }, [active]);

  // How far the picture may move each way at a scale: none until it
  // overflows the screen.
  const bounds = (at: number) => {
    "worklet";
    const shown = fitted(natural.value, width, height);
    return {
      x: Math.max(0, (shown.width * at - width) / 2),
      y: Math.max(0, (shown.height * at - height) / 2),
    };
  };
  const clamp = (value: number, limit: number) => {
    "worklet";
    return Math.min(limit, Math.max(-limit, value));
  };
  // Back inside the edges, or all the way out under a scale of 1.
  const settle = () => {
    "worklet";
    if (scale.value <= 1) {
      scale.value = withSpring(1, SPRING);
      x.value = withSpring(0, SPRING);
      y.value = withSpring(0, SPRING);
      scheduleOnRN(zoomTo, false);
      return;
    }
    const limit = bounds(scale.value);
    x.value = withSpring(clamp(x.value, limit.x), SPRING);
    y.value = withSpring(clamp(y.value, limit.y), SPRING);
    scheduleOnRN(zoomTo, true);
  };

  const pinch = usePinchGesture({
    onActivate: (event) => {
      // Android's pinch also takes a tap then a drag (its quick scale),
      // which is a swipe soon after a swipe here; two fingers only.
      if (event.numberOfPointers < 2) {
        GestureStateManager.fail(event.handlerTag);
        return;
      }
      // Zoomed from the first moment, so the pager doesn't page under
      // the fingers.
      scheduleOnRN(onZoom, true);
      start.value = {
        scale: scale.value,
        x: x.value,
        y: y.value,
        focalX: event.focalX - width / 2,
        focalY: event.focalY - height / 2,
      };
    },
    onUpdate: (event) => {
      if (event.numberOfPointers < 2) return;
      const from = start.value;
      const next = Math.min(MAX_SCALE, Math.max(0.8, from.scale * event.scale));
      // The point under the fingers stays under them.
      x.value = from.focalX - (next / from.scale) * (from.focalX - from.x);
      y.value = from.focalY - (next / from.scale) * (from.focalY - from.y);
      scale.value = next;
    },
    onDeactivate: () => settle(),
  });

  const pan = usePanGesture({
    enabled: zoomed,
    maxPointers: 1,
    onActivate: () => {
      start.value = { ...start.value, x: x.value, y: y.value };
    },
    onUpdate: (event) => {
      const limit = bounds(scale.value);
      x.value = clamp(start.value.x + event.translationX, limit.x);
      y.value = clamp(start.value.y + event.translationY, limit.y);
    },
    onDeactivate: (event) => {
      const limit = bounds(scale.value);
      x.value = withDecay({ velocity: event.velocityX, clamp: [-limit.x, limit.x] });
      y.value = withDecay({ velocity: event.velocityY, clamp: [-limit.y, limit.y] });
    },
  });

  const swipe = usePanGesture({
    enabled: !zoomed,
    maxPointers: 1,
    activeOffsetY: 12,
    failOffsetX: [-12, 12],
    onUpdate: (event) => {
      drag.x.value = event.translationX;
      drag.y.value = event.translationY;
    },
    onDeactivate: (event) => {
      // Far enough and not flung back up, or flung down; not when cut
      // short (a second finger).
      const closing = (event.translationY > CLOSE_DY && event.velocityY >= 0) || event.velocityY > CLOSE_VY;
      if (!event.canceled && closing) {
        drag.y.value = withTiming(height, { duration: tokens.dur });
        scheduleOnRN(onSwipeClose);
        return;
      }
      drag.x.value = withSpring(0, SPRING);
      drag.y.value = withSpring(0, SPRING);
    },
  });

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    maxDelay: DOUBLE_TAP_DELAY,
    maxDistance: DOUBLE_TAP_SLOP,
    onActivate: (event) => {
      if (scale.value > 1) {
        scale.value = withTiming(1, { duration: tokens.dur });
        x.value = withTiming(0, { duration: tokens.dur });
        y.value = withTiming(0, { duration: tokens.dur });
        scheduleOnRN(zoomTo, false);
        return;
      }
      // The tapped spot stays where it was, inside the edges.
      const limit = bounds(DOUBLE_TAP_SCALE);
      const focalX = event.x - width / 2;
      const focalY = event.y - height / 2;
      scale.value = withTiming(DOUBLE_TAP_SCALE, { duration: tokens.dur });
      x.value = withTiming(clamp(focalX * (1 - DOUBLE_TAP_SCALE), limit.x), { duration: tokens.dur });
      y.value = withTiming(clamp(focalY * (1 - DOUBLE_TAP_SCALE), limit.y), { duration: tokens.dur });
      scheduleOnRN(zoomTo, true);
    },
  });

  // Waits for a second tap before it counts.
  const singleTap = useTapGesture({
    requireToFail: doubleTap,
    maxDistance: TAP_SLOP,
    onActivate: () => {
      scheduleOnRN(onTap);
    },
  });

  const gesture = useSimultaneousGestures(pinch, pan, swipe, doubleTap, singleTap);

  const moved = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));

  const thumbnail = attachment.thumbnailFileId ? fileSource(origin, token, attachment.thumbnailFileId) : undefined;
  const known = attachment.width > 0 && attachment.height > 0;
  const fullSize = active && known && attachment.width * attachment.height <= FULL_SIZE_PIXELS;
  // With the size known, the original and its thumbnail fit the same
  // box, so nothing moves when one replaces the other; contained, so a
  // picture turned other than the server measured it is letterboxed,
  // not cropped.
  const box = known ? fitted(attachment, width, height) : { width, height };
  const fit = known ? "contain" : "scale-down";

  // A size the server didn't measure comes from the original once it
  // lands.
  const loaded = (event: ImageLoadEventData) => {
    if (known) return;
    natural.value = { width: event.source.width, height: event.source.height };
  };

  const retry = () => {
    setFailed(false);
    setAttempt((count) => count + 1);
  };

  return (
    <View
      ref={page}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={failed ? `${label}, couldn't load` : label}
      accessibilityHint={failed ? "Tries again" : undefined}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }, ...(failed ? [{ name: "activate" }] : [])]}
      onAccessibilityAction={({ nativeEvent }) => {
        if (nativeEvent.actionName === "activate") retry();
        else onStep(nativeEvent.actionName === "increment" ? 1 : -1);
      }}
      testID="viewer-page"
      style={{ width, height }}
    >
      {/* Untransformed, so the fingers' points are the screen's. */}
      <GestureDetector gesture={gesture}>
        <View style={styles.fill}>
          {failed ? (
            <View style={styles.failed}>
              <PhotoIcon color={MUTED} size={28} />
              <Text style={styles.failedWords}>Couldn't load this image.</Text>
              <Pressable onPress={retry} style={styles.retry}>
                <Text style={styles.retryWords}>Try again</Text>
              </Pressable>
            </View>
          ) : (
            <Animated.View style={[styles.fill, styles.center, moved]}>
              <Image
                key={attempt}
                source={fileSource(origin, token, attachment.fileId)}
                placeholder={thumbnail}
                placeholderContentFit={fit}
                contentFit={fit}
                allowDownscaling={!fullSize}
                recyclingKey={attachment.fileId}
                style={box}
                onLoad={loaded}
                onError={() => setFailed(true)}
              />
            </Animated.View>
          )}
        </View>
      </GestureDetector>
    </View>
  );
}

// A picture's size on screen: its own, shrunk to fit and never
// enlarged, as web's preview; the whole screen while it is unknown.
function fitted(own: { width: number; height: number }, width: number, height: number) {
  "worklet";
  if (!(own.width > 0 && own.height > 0)) return { width, height };
  const scale = Math.min(1, width / own.width, height / own.height);
  return { width: own.width * scale, height: own.height * scale };
}

// On the viewer's black, whatever the theme.
const MUTED = "rgba(255, 255, 255, 0.6)";

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  failed: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  failedWords: {
    color: MUTED,
    fontSize: tokens.textUi,
  },
  retry: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  retryWords: {
    color: "#ffffff",
    fontSize: tokens.textUi,
    fontWeight: "600",
  },
});
