import type { NativeStackHeaderItemButton } from "expo-router";

// Back as iOS's own bar button; Android draws BackButton.
export function backItem(onPress: () => void, tint: string): NativeStackHeaderItemButton {
  return {
    type: "button",
    label: "Back",
    accessibilityLabel: "Back",
    icon: { type: "sfSymbol", name: "chevron.left" },
    tintColor: tint,
    onPress,
  };
}
