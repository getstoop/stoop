import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useServerChipRoom } from "../../hooks/useServerChipRoom";

// How much of the bottom of the Spaces tab's body something lies over:
// on iOS the system tab bar and the home indicator under it, which the
// screen runs beneath, and the server chip on top of the bar when it
// shows (in the bar's own slot, which the safe area counts, or drawn
// over the screen: hooks/useServerChipRoom.ts); on Android nothing, the
// drawn tab bar and its chip being below the screen. Read from the SafeAreaProvider the tab puts around
// its body (./index.tsx), which measures the safe area where the body
// is, tab bar included; the app's root provider knows only the window's.
// The rail and the pane pad their scrolling content by it, so the last
// row always comes clear, however the scroll got there.
export function useBottomObstruction(): number {
  return useSafeAreaInsets().bottom + useServerChipRoom();
}
