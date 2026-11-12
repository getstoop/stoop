import { Animated, type DimensionValue } from "react-native";
import { tokens, useTheme } from "../theme";
import { usePulse } from "./usePulse";

// One placeholder block of a skeleton: a plain shape where a line of
// text, an icon or a tile will be once it has loaded, pulsing with the
// others under the same Skeleton or SkeletonPulse. Hidden from a screen
// reader; the Skeleton around it says "Loading".
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
  const opacity = usePulse();
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width, height, borderRadius: radius, backgroundColor: theme.raised, opacity }}
    />
  );
}
