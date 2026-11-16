import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Platform } from "react-native";
import { useCallBarShown } from "../call/CallProvider";
import { CALL_BAR_HEIGHT, tabRow } from "../call/callBar";
import { useServers } from "../servers";
import { tokens } from "../theme";

// The chip's height (components/ServerChip.tsx), which a screen it is
// drawn over pads by.
export const SERVER_CHIP_HEIGHT = 48;

// The row by the tab bar: the call bar while in a call
// (components/CallBar.tsx), which takes the server chip's place, else
// the chip with more than one server saved, else none.
export function useTabRow(): "call" | "chip" | null {
  return tabRow(useCallBarShown(), useServers().servers.length);
}

// Where the chip is drawn. Where iOS has Liquid Glass (iOS 26) the
// system tab bar has a slot of its own over it ("slot":
// (tabs)/_layout.ios.tsx puts the chip there, and the system counts it
// into each tab's safe area). Elsewhere on iOS the tab bar lies over the
// screen and has no slot, so each tab's
// screen draws the chip over its own foot ("overlay":
// components/TabRowOverlay.tsx). Android's drawn tab bar carries the
// chip itself, at the foot of the screen ("bar": (tabs)/_layout.tsx).
// The call bar goes where the chip does, but for the slot, which it has
// no drawing for yet: on iOS 26 the slot is emptied while in a call and
// each tab's screen draws the bar, floating over the tab bar.
export const serverChipPlace: "slot" | "overlay" | "bar" =
  Platform.OS !== "ios" ? "bar" : isLiquidGlassAvailable() ? "slot" : "overlay";

// The air under the call bar floating over iOS 26's tab bar.
export const CALL_BAR_FLOAT_GAP = 8;

// How far the top of Android's drawn tab bar (the row's, when one
// shows) lies over the foot of the screen: its top corners are rounded
// as a sheet's are, so the bar is pulled up over the screen by the
// radius, and the screen shows in the corners.
export const TAB_BAR_OVERLAP = Platform.OS === "android" ? tokens.radiusLg : 0;

// How much of the foot of a tab's screen the row or the bar lies over
// that the safe area doesn't already count, for the screen's lists to
// pad by: the row's height where the screen draws it over itself, the
// rounded top of the bar on Android, else nothing.
export function useServerChipRoom(): number {
  const row = useTabRow();
  if (row === "call" && serverChipPlace === "slot") return CALL_BAR_HEIGHT + CALL_BAR_FLOAT_GAP;
  if (row === "call" && serverChipPlace === "overlay") return CALL_BAR_HEIGHT;
  return row === "chip" && serverChipPlace === "overlay" ? SERVER_CHIP_HEIGHT : TAB_BAR_OVERLAP;
}
