import type { ReactNode } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import SkeletonPulse from "./SkeletonPulse";
import { usePulse } from "./usePulse";

// A region standing in for content still loading: SkeletonBlocks laid
// out as the content will be, pulsing gently together. It reads as one
// thing, "Loading", to a screen reader, with its blocks hidden. Inside
// a SkeletonPulse it keeps that one's time.
export default function Skeleton({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const shared = usePulse();
  const region = (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading" style={style}>
      {children}
    </View>
  );
  return shared ? region : <SkeletonPulse>{region}</SkeletonPulse>;
}
