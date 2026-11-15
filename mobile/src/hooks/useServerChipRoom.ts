import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Platform } from "react-native";
import { useServers } from "../servers";
import { tokens } from "../theme";

// The chip's height (components/ServerChip.tsx), which a screen it is
// drawn over pads by.
export const SERVER_CHIP_HEIGHT = 48;

// Whether the server chip shows by the tab bar: only with more than one
// server saved.
export function useServerChipShown(): boolean {
  return useServers().servers.length > 1;
}

// Where the chip is drawn. Where iOS has Liquid Glass (iOS 26) the
// system tab bar has a slot of its own over it ("slot":
// (tabs)/_layout.ios.tsx puts the chip there, and the system counts it
// into each tab's safe area). Elsewhere on iOS the tab bar lies over the
// screen and has no slot, so each tab's
// screen draws the chip over its own foot ("overlay":
// components/ServerChipOverlay.tsx). Android's drawn tab bar carries the
// chip itself, at the foot of the screen ("bar": (tabs)/_layout.tsx).
export const serverChipPlace: "slot" | "overlay" | "bar" =
  Platform.OS !== "ios" ? "bar" : isLiquidGlassAvailable() ? "slot" : "overlay";

// How far the top of Android's drawn tab bar (the chip's, when it
// shows) lies over the foot of the screen: its top corners are rounded
// as a sheet's are, so the bar is pulled up over the screen by the
// radius, and the screen shows in the corners.
export const TAB_BAR_OVERLAP = Platform.OS === "android" ? tokens.radiusLg : 0;

// How much of the foot of a tab's screen the chip or the bar lies over
// that the safe area doesn't already count, for the screen's lists to
// pad by: the chip's height where the screen draws it over itself, the
// rounded top of the bar on Android, else nothing.
export function useServerChipRoom(): number {
  const shown = useServerChipShown();
  return serverChipPlace === "overlay" && shown ? SERVER_CHIP_HEIGHT : TAB_BAR_OVERLAP;
}
