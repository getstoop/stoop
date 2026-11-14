import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// How much of the screen the on-screen keyboard covers, 0 when it is
// down, so a screen can keep its bottom button above it. iOS reports the
// keyboard before it moves (so the screen moves with it); Android only
// after. Android also measures the keyboard from the top of its
// navigation bar, which the app draws under (edge to edge), so the bar's
// height is added back: without it a button stood that much behind the
// keys.
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  const bar = useSafeAreaInsets().bottom;

  useEffect(() => {
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", (e) =>
      setHeight(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () =>
      setHeight(0),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return Platform.OS === "android" && height > 0 ? height + bar : height;
}
