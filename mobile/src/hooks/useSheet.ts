import { useCallback, useRef } from "react";
import type { LayoutChangeEvent } from "react-native";
import { usePanGesture } from "react-native-gesture-handler";
import {
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

// A sheet drawn up from the bottom of a modal (the message menu, Attach,
// the conversation menu): once measured it slides in from its own height
// below its place while the modal's scrim (`shown`, the modal's own,
// which starts at 0) fades in, the two started together so neither is
// ahead of the other; it follows a finger dragging it down, and closes
// on a swipe far or fast enough, or on dismiss, sliding out while the
// scrim fades; onClose runs when it has gone. It starts gently, while
// the modal is still being put up, and settles slowly; it goes out
// quicker, gathering speed, or, let go mid-swipe, carries on at the
// finger's speed. All of it runs off the JavaScript thread (Reanimated,
// and the system's own pan recogniser through `gesture`), so the sheet
// keeps to the finger whatever the app is doing; the modal's root must
// be a GestureHandlerRootView for the pan to be heard. A sheet on its
// way out takes no more actions (`closing`): a second tap during the
// slide-out would otherwise do the first one's work again. The message
// menu and its emoji picker are each one of these, over the one scrim:
// the picker's way in also carries the scrim to full, should the menu's
// have been cut short by the swap. Under Reduce Motion the sheet and
// the scrim come and go at once (Reanimated's default).

// Off screen until the sheet has been measured.
const OFF = 2000;
// How far, or how fast (points a second), a swipe down must go to close
// the sheet.
const DISMISS_DY = 80;
const DISMISS_VY = 600;
// The way in and the way out. Longer than the app's other changes
// (tokens.dur): a sheet crosses a good part of the screen.
const IN = { duration: 320, easing: Easing.bezier(0.2, 0, 0, 1) };
const OUT = { duration: 220, easing: Easing.bezier(0.4, 0, 1, 1) };
// The shortest way out a hard fling gets.
const FLING_MS = 120;
// Back to its place when let go short of closing, without a bounce.
const SETTLE = { damping: 30, stiffness: 300 };

export function useSheet(shown: SharedValue<number>, onClose: () => void) {
  const offset = useSharedValue(OFF);
  const drag = useSharedValue(0);
  const height = useRef(0);
  const closing = useRef(false);

  // Out, from wherever a drag left it. Let go moving (`velocity`, points
  // a second), it leaves at that speed and slows, in no longer than the
  // plain way out takes.
  const leave = useCallback(
    (velocity: number) => {
      if (closing.current) return;
      closing.current = true;
      const far = height.current || OFF;
      const left = Math.max(far - drag.value, 0);
      const out =
        velocity > 0
          ? {
              duration: Math.min(Math.max((2000 * left) / velocity, FLING_MS), OUT.duration),
              easing: Easing.out(Easing.quad),
            }
          : OUT;
      shown.value = withTiming(0, out);
      // Whether or not it ran to its end, the sheet is done with.
      offset.value = withTiming(left, out, () => {
        scheduleOnRN(onClose);
      });
    },
    [shown, offset, drag, onClose],
  );

  const dismiss = useCallback(() => leave(0), [leave]);

  // Downward only: a drag up, or sideways, is not the sheet's.
  const gesture = usePanGesture({
    maxPointers: 1,
    activeOffsetY: 8,
    failOffsetX: [-16, 16],
    onUpdate: (event) => {
      drag.value = Math.max(0, event.translationY);
    },
    onDeactivate: (event) => {
      // Far enough and not flung back up, or flung down; not when cut
      // short (a second finger).
      const close = (event.translationY > DISMISS_DY && event.velocityY >= 0) || event.velocityY > DISMISS_VY;
      if (!event.canceled && close) {
        scheduleOnRN(leave, Math.max(0, event.velocityY));
        return;
      }
      drag.value = withSpring(0, SETTLE);
    },
  });

  // The first measure slides the sheet in and fades the scrim in with
  // it; later ones (a sheet that shrinks for the keyboard) only keep the
  // height the slide-out uses. A sheet measured while already closing
  // stays out.
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const measured = height.current;
      height.current = event.nativeEvent.layout.height;
      if (measured || closing.current) return;
      offset.value = height.current;
      shown.value = withTiming(1, IN);
      offset.value = withTiming(0, IN);
    },
    [shown, offset],
  );

  // The sheet's place, and the scrim's (and the card's) fade.
  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value + drag.value }] }));
  const fade = useAnimatedStyle(() => ({ opacity: shown.value }));

  const isClosing = useCallback(() => closing.current, []);

  return { dismiss, closing: isClosing, onLayout, slide, fade, gesture };
}
