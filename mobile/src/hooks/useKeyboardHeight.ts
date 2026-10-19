import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

// How much of the screen the on-screen keyboard covers, 0 when it is
// down, so a screen can keep its bottom button above it. iOS reports the
// keyboard before it moves (so the screen moves with it); Android only
// after.
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

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

  return height;
}
