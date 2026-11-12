import { type ReactNode, useEffect, useRef } from "react";
import { Animated, Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSheet } from "../hooks/useSheet";
import { type Theme, tokens, useTheme } from "../theme";

// A sheet over the screen, in its own modal: a scrim, an optional card
// above the sheet, and the sheet itself, with its handle, drawn up from
// the bottom over the safe area. A tap on the scrim, a swipe down or
// Android's back closes it (useSheet), and onClose runs once it has
// slid out. What it holds is the caller's: a menu's items (MenuSheet),
// or something to read.

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
  const insets = useSafeAreaInsets();
  const shown = useRef(new Animated.Value(0)).current;
  const { dismiss, closing, onLayout, slide, panHandlers } = useSheet(shown, onClose);

  useEffect(() => {
    Animated.timing(shown, { toValue: 1, duration: tokens.dur, useNativeDriver: true }).start();
  }, [shown]);

  return (
    <Modal transparent visible animationType="none" onRequestClose={dismiss} statusBarTranslucent navigationBarTranslucent>
      <View style={styles.fill} onAccessibilityEscape={dismiss}>
        <Animated.View style={[styles.scrim, { opacity: shown }]} pointerEvents="none" />
        <View style={styles.above}>
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={dismiss}
            testID={closeTestID}
          />
          {card && (
            <Animated.View style={[styles.card, { opacity: shown }]} pointerEvents="none">
              {card}
            </Animated.View>
          )}
        </View>
        <Animated.View
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 8) + 8, transform: [{ translateY: slide }] }]}
          accessibilityRole={menu ? "menu" : undefined}
          accessibilityLabel={label}
          onLayout={onLayout}
          {...panHandlers}
        >
          <View style={styles.handle} />
          {typeof children === "function" ? children({ dismiss, closing }) : children}
        </Animated.View>
      </View>
    </Modal>
  );
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
