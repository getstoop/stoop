import type { NativeStackHeaderItemButton } from "expo-router";

// The channel header's Search, and the thread's, as either platform
// draws it: on iOS a bar button item (searchItem), which the system
// draws as it draws the back button, Liquid Glass from iOS 26;
// elsewhere SearchButton. Both take these props.
export type SearchProps = {
  spaceName: string;
  onPress: () => void;
};

export const searchLabel = (spaceName: string): string => `Search in ${spaceName}`;

export function searchItem({ spaceName, onPress }: SearchProps): NativeStackHeaderItemButton {
  return {
    type: "button",
    label: "Search",
    accessibilityLabel: searchLabel(spaceName),
    icon: { type: "sfSymbol", name: "magnifyingglass" },
    onPress,
  };
}
