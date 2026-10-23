import { useCallback, useMemo, useRef } from "react";
import { Animated, type LayoutChangeEvent, PanResponder } from "react-native";
import { tokens } from "../../theme";

// A sheet drawn up from the bottom of the message menu's modal: it slides
// in from its own height below its place once measured, follows a finger
// dragging it down, and closes on a swipe far or fast enough, or on
// dismiss, sliding out while the modal's scrim (`shown`, the modal's
// own) fades; onClose runs when both are done. A sheet on its way out
// takes no more actions (`closing`): a second tap during the slide-out
// would otherwise do the first one's work again. The menu and the
// emoji picker are each one of these, over the one scrim.

// Off screen until the sheet has been measured.
const OFF = 2000;
// How far, or how fast, a swipe down must go to close the sheet.
const DISMISS_DY = 80;
const DISMISS_VY = 0.6;

export function useSheet(shown: Animated.Value, onClose: () => void) {
  const offset = useRef(new Animated.Value(OFF)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const height = useRef(0);
  const closing = useRef(false);

  const dismiss = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    Animated.parallel([
      Animated.timing(shown, { toValue: 0, duration: tokens.dur, useNativeDriver: true }),
      Animated.timing(offset, { toValue: height.current || OFF, duration: tokens.dur, useNativeDriver: true }),
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

  // The first measure slides the sheet in; later ones (a sheet that
  // shrinks for the keyboard) only keep the height the slide-out uses.
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const measured = height.current;
      height.current = event.nativeEvent.layout.height;
      if (measured) return;
      offset.setValue(height.current);
      Animated.timing(offset, { toValue: 0, duration: tokens.dur, useNativeDriver: true }).start();
    },
    [offset],
  );

  const slide = useMemo(
    () => Animated.add(offset, drag.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolateLeft: "clamp" })),
    [offset, drag],
  );

  const isClosing = useCallback(() => closing.current, []);

  return { dismiss, closing: isClosing, onLayout, slide, panHandlers: pan.panHandlers };
}
