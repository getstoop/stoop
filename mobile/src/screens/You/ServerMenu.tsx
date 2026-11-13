import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TrashIcon } from "../../components/Icons";
import SheetFrame from "../../components/SheetFrame";
import { useSheet } from "../../hooks/useSheet";
import type { SavedServer } from "../../servers";
import type { Waiting } from "../../servers/useWaiting";
import { type Theme, tokens, useTheme } from "../../theme";
import { confirmRemove } from "./confirmRemove";
import ServerEntry from "./ServerEntry";

// A server's menu, opened by a long press on its row, as a conversation's
// is: a scrim, the row drawn once more as a card, and a sheet holding
// Remove. Its confirm shows over the sheet, and Cancel leaves the sheet
// open. A tap on the scrim, a swipe down or Android's back closes it with
// nothing (useSheet).
export default function ServerMenu({
  server,
  current,
  waiting,
  onRemove,
  onClose,
}: {
  server: SavedServer;
  current: boolean;
  waiting?: Waiting;
  onRemove: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const shown = useSharedValue(0);
  const sheet = useSheet(shown, onClose);
  const { dismiss, closing, fade } = sheet;

  const remove = () => {
    if (closing()) return;
    confirmRemove(server, () => {
      onRemove();
      dismiss();
    });
  };

  return (
    <Modal transparent visible animationType="none" onRequestClose={dismiss} statusBarTranslucent navigationBarTranslucent>
      <GestureHandlerRootView style={styles.fill} onAccessibilityEscape={dismiss}>
        <Animated.View style={[styles.scrim, fade]} pointerEvents="none" />
        <View style={styles.above}>
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={dismiss}
            testID="server-menu-close"
          />
          <Animated.View style={[styles.card, fade]} pointerEvents="none">
            <ServerEntry server={server} current={current} waiting={waiting} />
          </Animated.View>
        </View>
        <SheetFrame
          sheet={sheet}
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 8) + 8 }]}
          accessibilityRole="menu"
          accessibilityLabel="Server actions"
        >
          <View style={styles.handle} />
          <Pressable
            accessibilityRole="menuitem"
            accessibilityLabel="Remove from this phone"
            onPress={remove}
            style={({ pressed }) => [styles.item, pressed && styles.pressed]}
          >
            <TrashIcon color={theme.danger} size={22} />
            <Text style={styles.label}>Remove from this phone</Text>
          </Pressable>
        </SheetFrame>
      </GestureHandlerRootView>
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
      overflow: "hidden",
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
    pressed: {
      backgroundColor: theme.hover,
    },
    label: {
      flex: 1,
      color: theme.danger,
      fontSize: tokens.textBody,
    },
  });
}
