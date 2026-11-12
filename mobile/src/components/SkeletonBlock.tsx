import { type DimensionValue, View } from "react-native";
import { tokens, useTheme } from "../theme";

// One placeholder block of a skeleton: a plain shape where a line of
// text, an icon or a tile will be once it has loaded. Hidden from a
// screen reader; the Skeleton around it says "Loading".
export default function SkeletonBlock({
  width,
  height,
  radius = tokens.radius,
}: {
  width: DimensionValue;
  height: number;
  radius?: number;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width, height, borderRadius: radius, backgroundColor: theme.raised }}
    />
  );
}
