import { type ReactNode, useEffect, useState } from "react";
import { type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import SkeletonPulse from "./SkeletonPulse";
import { usePulse } from "./usePulse";

// A region standing in for content still loading: SkeletonBlocks laid
// out as the content will be, pulsing gently together. It reads as one
// thing, "Loading", to a screen reader, with its blocks hidden; `silent`
// is one that says nothing, beside another that does. Inside a
// SkeletonPulse it keeps that one's time. It holds its place from the
// start but draws only after a moment: a load that is over by then
// never shows it, where it was a flash of blocks before the content.
// One that takes the place of another already drawn (a pane's, after
// its tab's) draws at once, so the blocks don't blink out between them.
const SHOWN_AFTER_MS = 200;

// How many skeletons are drawn now.
let drawn = 0;

export default function Skeleton({
  style,
  silent = false,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  silent?: boolean;
  children: ReactNode;
}) {
  const shared = usePulse();
  const [shown, setShown] = useState(() => drawn > 0);
  useEffect(() => {
    if (shown) {
      drawn += 1;
      return () => {
        drawn -= 1;
      };
    }
    const timer = setTimeout(() => setShown(true), SHOWN_AFTER_MS);
    return () => clearTimeout(timer);
  }, [shown]);
  const hidden = !shown && styles.hidden;
  const region = silent ? (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[style, hidden]}>
      {children}
    </View>
  ) : (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading" style={[style, hidden]}>
      {children}
    </View>
  );
  return shared ? region : <SkeletonPulse>{region}</SkeletonPulse>;
}

const styles = StyleSheet.create({
  hidden: {
    opacity: 0,
  },
});
