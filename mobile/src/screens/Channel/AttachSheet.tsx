import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraIcon, FileIcon, PhotoIcon } from "../../components/Icons";
import { useSheet } from "../../hooks/useSheet";
import { type Theme, tokens, useTheme } from "../../theme";

// Where the composer's Attach (the + in the pill or the card) picks files
// from: a sheet over a scrim, drawn as the message menu's is (useSheet),
// with the photo library, the camera and files. A pick closes the sheet
// and is handed over (onClose) once it has gone: on iOS once the modal
// itself is dismissed, since a picker presented over it would be
// dismissed with it, or after a moment should that never be said, so a
// pick is never lost and the sheet never stays up. A tap on the scrim, a
// swipe down or Android's back closes it with nothing.

export type AttachSource = "library" | "camera" | "files";

const ITEMS = [
  { source: "library", label: "Photo library", Icon: PhotoIcon },
  { source: "camera", label: "Camera", Icon: CameraIcon },
  { source: "files", label: "Files", Icon: FileIcon },
] as const;

// How long iOS gets to say the modal has gone before it is taken as gone.
const DISMISS_FALLBACK_MS = 1000;

export default function AttachSheet({ onClose }: { onClose: (source: AttachSource | null) => void }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const shown = useRef(new Animated.Value(0)).current;
  const picked = useRef<AttachSource | null>(null);
  const [visible, setVisible] = useState(true);
  // Handed over once, whichever of the two says it has gone.
  const handed = useRef(false);
  const gone = useCallback(() => {
    if (handed.current) return;
    handed.current = true;
    onClose(picked.current);
  }, [onClose]);
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closed = useCallback(() => {
    if (Platform.OS !== "ios") {
      gone();
      return;
    }
    setVisible(false);
    fallback.current = setTimeout(gone, DISMISS_FALLBACK_MS);
  }, [gone]);
  useEffect(
    () => () => {
      if (fallback.current) clearTimeout(fallback.current);
    },
    [],
  );
  const { dismiss, closing, onLayout, slide, panHandlers } = useSheet(shown, closed);

  useEffect(() => {
    Animated.timing(shown, { toValue: 1, duration: tokens.dur, useNativeDriver: true }).start();
  }, [shown]);

  const pick = (source: AttachSource) => {
    if (closing()) return;
    picked.current = source;
    dismiss();
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={dismiss}
      onDismiss={gone}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={styles.fill} onAccessibilityEscape={dismiss}>
        <Animated.View style={[styles.scrim, { opacity: shown }]} pointerEvents="none" />
        <Pressable
          style={styles.fill}
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={dismiss}
          testID="attach-sheet-close"
        />
        <Animated.View
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 8) + 8, transform: [{ translateY: slide }] }]}
          accessibilityRole="menu"
          accessibilityLabel="Attach"
          onLayout={onLayout}
          {...panHandlers}
        >
          <View style={styles.handle} />
          {ITEMS.map(({ source, label, Icon }) => (
            <Pressable
              key={source}
              accessibilityRole="menuitem"
              accessibilityLabel={label}
              onPress={() => pick(source)}
              style={({ pressed }) => [styles.item, pressed && styles.pressed]}
            >
              <Icon color={theme.textMuted} />
              <Text style={styles.label}>{label}</Text>
            </Pressable>
          ))}
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
      color: theme.text,
      fontSize: 16,
    },
  });
}
