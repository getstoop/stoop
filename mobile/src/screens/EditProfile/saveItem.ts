import type { NativeStackHeaderItemButton } from "expo-router";
import type { SaveProps } from "./saveProps";

// Save as iOS's own bar button; Android draws SaveButton.
export function saveItem({ label, disabled, onPress }: SaveProps, accent: string): NativeStackHeaderItemButton {
  return { type: "button", label, accessibilityLabel: label, tintColor: accent, labelStyle: { fontWeight: "700" }, disabled, onPress };
}
