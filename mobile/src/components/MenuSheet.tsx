import { type ReactNode, useEffect, useRef } from "react";
import { Animated, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { initialWindowMetrics, SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { useSheet } from "../hooks/useSheet";
import { type Theme, tokens, useTheme } from "../theme";

// The menu a long press on a row opens (a conversation's, a channel's):
// a scrim over the screen, the row drawn once more as a card, and a
// sheet of items under it. Picking an item runs it and closes the
// sheet; a disabled one is drawn dimmed, takes no press and is
// announced as disabled. A tap on the scrim, a swipe down or Android's
// back closes it with nothing (useSheet). The modal covers the whole
// window, the tab bar included, so it measures its own safe area: the
// one around the screen that opened it can count the tab bar in.

export type MenuSheetItem = {
  label: string;
  icon: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
};

export default function MenuSheet({
  label,
  closeTestID,
  card,
  items,
  onClose,
}: {
  // What a screen reader calls the sheet.
  label: string;
  // The scrim's, for the flows.
  closeTestID: string;
  card: ReactNode;
  items: MenuSheetItem[];
  onClose: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const shown = useRef(new Animated.Value(0)).current;
  const { dismiss, closing, onLayout, slide, panHandlers } = useSheet(shown, onClose);

  useEffect(() => {
    Animated.timing(shown, { toValue: 1, duration: tokens.dur, useNativeDriver: true }).start();
  }, [shown]);

  const pick = (item: MenuSheetItem) => () => {
    if (closing()) return;
    item.onPress?.();
    dismiss();
  };

  return (
    <Modal transparent visible animationType="none" onRequestClose={dismiss} statusBarTranslucent navigationBarTranslucent>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
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
            <Animated.View style={[styles.card, { opacity: shown }]} pointerEvents="none">
              {card}
            </Animated.View>
          </View>
          <Animated.View
            style={[styles.sheet, { transform: [{ translateY: slide }] }]}
            accessibilityRole="menu"
            accessibilityLabel={label}
            onLayout={onLayout}
            {...panHandlers}
          >
            <View style={styles.handle} />
            {items.map((item) => (
              <Pressable
                key={item.label}
                accessibilityRole="menuitem"
                accessibilityLabel={item.label}
                disabled={item.disabled}
                onPress={pick(item)}
                style={({ pressed }) => [styles.item, item.disabled && styles.disabled, pressed && styles.pressed]}
              >
                {item.icon}
                <Text style={styles.label}>{item.label}</Text>
              </Pressable>
            ))}
            <SheetFoot />
          </Animated.View>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}

// The room under the last item: what the window keeps clear at its
// bottom (the home indicator, Android's navigation bar), and a little
// more.
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
    item: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      minHeight: 52,
      paddingHorizontal: 12,
      borderRadius: tokens.radiusMd,
    },
    disabled: {
      opacity: tokens.disabled,
    },
    pressed: {
      backgroundColor: theme.hover,
    },
    label: {
      flex: 1,
      color: theme.text,
      fontSize: 16,
    },
  });
}
