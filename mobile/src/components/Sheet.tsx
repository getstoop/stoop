import type { ReactNode } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useSharedValue } from "react-native-reanimated";
import { initialWindowMetrics, SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { useSheet } from "../hooks/useSheet";
import SheetFrame from "./SheetFrame";
import { type Theme, tokens, useTheme } from "../theme";

// A sheet over the screen, in its own modal: a scrim, an optional card
// above the sheet, and the sheet itself, with its handle, drawn up from
// the bottom over the safe area. A tap on the scrim, a swipe down or
// Android's back closes it (useSheet), and onClose runs once it has
// slid out. What it holds is the caller's: a menu's items (MenuSheet),
// or something to read. The modal covers the whole window, the tab bar
// included, so it measures its own safe area: the one around the
// screen that opened it can count the tab bar in.

export type SheetControls = {
  // Slides the sheet out, then onClose.
  dismiss: () => void;
  // Whether it is already on its way out, and should take no more presses.
  closing: () => boolean;
};

export default function Sheet({
  label,
  menu = false,
  closeTestID,
  card,
  onClose,
  children,
}: {
  // What a screen reader calls the sheet.
  label: string;
  // Whether it is a menu of items, for a screen reader.
  menu?: boolean;
  // The scrim's, for the flows.
  closeTestID: string;
  card?: ReactNode;
  onClose: () => void;
  children: ReactNode | ((sheet: SheetControls) => ReactNode);
}) {
  const styles = makeStyles(useTheme());
  const shown = useSharedValue(0);
  const sheet = useSheet(shown, onClose);
  const { dismiss, closing, fade } = sheet;

  return (
    <Modal transparent visible animationType="none" onRequestClose={dismiss} statusBarTranslucent navigationBarTranslucent>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <GestureHandlerRootView style={styles.fill} onAccessibilityEscape={dismiss}>
          <Animated.View style={[styles.scrim, fade]} pointerEvents="none" />
          <View style={styles.above}>
            <Pressable
              style={StyleSheet.absoluteFill}
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={dismiss}
              testID={closeTestID}
            />
            {card && (
              <Animated.View style={[styles.card, fade]} pointerEvents="none">
                {card}
              </Animated.View>
            )}
          </View>
          <SheetFrame
            sheet={sheet}
            style={styles.sheet}
            accessibilityRole={menu ? "menu" : undefined}
            accessibilityLabel={label}
          >
            <View style={styles.handle} />
            {typeof children === "function" ? children({ dismiss, closing }) : children}
            <SheetFoot />
          </SheetFrame>
        </GestureHandlerRootView>
      </SafeAreaProvider>
    </Modal>
  );
}

// The room under what the sheet holds: what the window keeps clear at
// its bottom (the home indicator, Android's navigation bar), and a
// little more.
function SheetFoot() {
  const insets = useSafeAreaInsets();
  return <View style={{ height: Math.max(insets.bottom, 8) + 8 }} />;
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    fill: {
      flex: 1,
    },
    scrim: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: theme.scrim,
    },
    above: {
      flex: 1,
      justifyContent: "flex-end",
      paddingHorizontal: 16,
      paddingBottom: 12,
    },
    card: {
      borderRadius: tokens.radiusLg,
      backgroundColor: theme.surface,
    },
    sheet: {
      paddingTop: 8,
      paddingHorizontal: 8,
      borderTopLeftRadius: tokens.radiusLg,
      borderTopRightRadius: tokens.radiusLg,
      backgroundColor: theme.panel,
    },
    handle: {
      alignSelf: "center",
      width: 36,
      height: 5,
      marginBottom: 12,
      borderRadius: tokens.radiusPill,
      backgroundColor: theme.border,
    },
  });
}
