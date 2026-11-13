import type { ReactNode } from "react";
import { type AccessibilityRole, Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";
import { REACH, type useSheet } from "../hooks/useSheet";

// A sheet's moving part (useSheet): the sheet itself, and a strip of
// the scrim just above it that is the sheet's to be dragged by, since a
// finger reaching for the handle lands above the sheet's edge as often
// as on it. A swipe down that starts anywhere on either moves the
// sheet; a tap on the strip closes it, as a tap on the scrim around it
// does. The strip overlaps what is above the sheet, so it moves
// nothing.

export default function SheetFrame({
  sheet,
  style,
  accessibilityRole,
  accessibilityLabel,
  children,
}: {
  sheet: Pick<ReturnType<typeof useSheet>, "slide" | "gesture" | "onLayout" | "dismiss">;
  // The sheet's own look.
  style: StyleProp<ViewStyle>;
  accessibilityRole?: AccessibilityRole;
  accessibilityLabel: string;
  children: ReactNode;
}) {
  return (
    <GestureDetector gesture={sheet.gesture}>
      <Animated.View style={[styles.frame, sheet.slide]} onLayout={sheet.onLayout}>
        <Pressable
          style={styles.reach}
          onPress={sheet.dismiss}
          accessible={false}
          importantForAccessibility="no"
        />
        <View style={style} accessibilityRole={accessibilityRole} accessibilityLabel={accessibilityLabel}>
          {children}
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  frame: {
    marginTop: -REACH,
  },
  reach: {
    height: REACH,
  },
});
