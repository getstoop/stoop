import { useCallback, useMemo, useRef } from "react";
import { Animated, Easing, type LayoutChangeEvent, PanResponder } from "react-native";

// A sheet drawn up from the bottom of a modal (the message menu, Attach,
// the conversation menu): once measured it slides in from its own height
// below its place while the modal's scrim (`shown`, the modal's own,
// which starts at 0) fades in, the two as one animation so neither
// starts ahead of the other; it follows a finger dragging it down, and
// closes on a swipe far or fast enough, or on dismiss, sliding out while
// the scrim fades; onClose runs when both are done. It starts gently,
// while the modal is still being put up, and settles slowly; it goes
// out quicker, gathering speed. A sheet on its way out takes no more
// actions (`closing`): a second tap during the slide-out would otherwise
// do the first one's work again. The message menu and its emoji picker
// are each one of these, over the one scrim: the picker's way in also
// carries the scrim to full, should the menu's have been cut short by
// the swap. The way in and the way out list the scrim first, then the
// sheet: a dismiss during the way in stops it whole before the way
// out's own slide starts, and that order is what makes it so.

// Off screen until the sheet has been measured.
const OFF = 2000;
// How far, or how fast, a swipe down must go to close the sheet.
const DISMISS_DY = 80;
const DISMISS_VY = 0.6;
// The way in and the way out. Longer than the app's other changes
// (tokens.dur): a sheet crosses a good part of the screen.
const IN = { duration: 320, easing: Easing.bezier(0.2, 0, 0, 1), useNativeDriver: true };
const OUT = { duration: 220, easing: Easing.bezier(0.4, 0, 1, 1), useNativeDriver: true };

export function useSheet(shown: Animated.Value, onClose: () => void) {
  const offset = useRef(new Animated.Value(OFF)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const height = useRef(0);
  const closing = useRef(false);

  const dismiss = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    Animated.parallel([
      Animated.timing(shown, { ...OUT, toValue: 0 }),
      Animated.timing(offset, { ...OUT, toValue: height.current || OFF }),
    ]).start(onClose);
  }, [shown, offset, onClose]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_event, gesture) => drag.setValue(gesture.dy),
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dy > DISMISS_DY || gesture.vy > DISMISS_VY) dismiss();
          else Animated.spring(drag, { toValue: 0, bounciness: 0, useNativeDriver: true }).start();
        },
        onPanResponderTerminate: () =>
          Animated.spring(drag, { toValue: 0, bounciness: 0, useNativeDriver: true }).start(),
      }),
    [drag, dismiss],
  );

  // The first measure slides the sheet in and fades the scrim in with
  // it; later ones (a sheet that shrinks for the keyboard) only keep the
  // height the slide-out uses. A sheet measured while already closing
  // stays out.
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const measured = height.current;
      height.current = event.nativeEvent.layout.height;
      if (measured || closing.current) return;
      offset.setValue(height.current);
      Animated.parallel([
        Animated.timing(shown, { ...IN, toValue: 1 }),
        Animated.timing(offset, { ...IN, toValue: 0 }),
      ]).start();
    },
    [shown, offset],
  );

  const slide = useMemo(
    () => Animated.add(offset, drag.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolateLeft: "clamp" })),
    [offset, drag],
  );

  const isClosing = useCallback(() => closing.current, []);

  return { dismiss, closing: isClosing, onLayout, slide, panHandlers: pan.panHandlers };
}
