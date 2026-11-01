import * as Haptics from "expo-haptics";
import { type ReactNode, useRef, useState } from "react";
import { type LayoutChangeEvent, Pressable, StyleSheet, Text, View } from "react-native";
import Swipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { type SharedValue, useAnimatedReaction, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { CloseIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";

// A Messages row that swipes left to show Close, a shortcut for its
// menu's Close conversation (onClose). A swipe past most of the row's
// width closes it on letting go, where the finger is when it lets go
// deciding, with a buzz when it gets that far; short of that it rests
// open on Close. Behind the row is Close's colour, so a long swipe reads
// as Close growing. One row rests open at a time (onSwipe: the screen
// closes the last as another starts). Close is drawn under every row,
// so a screen reader is kept from it until the row is open; it has Close
// among the row's own actions instead.

const ACTION_WIDTH = 88;
// How far across the row, as a share of its width, a swipe closes it.
const FULL_SWIPE = 0.6;

export default function SwipeToClose({
  children,
  onClose,
  onSwipe,
}: {
  children: ReactNode;
  onClose: () => void;
  onSwipe: (row: SwipeableMethods) => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const row = useRef<SwipeableMethods>(null);
  const width = useSharedValue(0);
  // The row's offset, as the swipeable hands it to its actions.
  const offset = useRef<SharedValue<number> | null>(null);
  const [open, setOpen] = useState(false);
  const buzz = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  const swiping = () => {
    if (row.current) onSwipe(row.current);
  };

  return (
    <View
      onLayout={(event: LayoutChangeEvent) => {
        width.value = event.nativeEvent.layout.width;
      }}
    >
      <Swipeable
        ref={row}
        friction={1}
        rightThreshold={ACTION_WIDTH / 2}
        containerStyle={styles.behind}
        childrenContainerStyle={styles.front}
        renderRightActions={(_progress, translation) => {
          offset.current = translation;
          return (
            <CloseAction
              translation={translation}
              width={width}
              hidden={!open}
              onFull={buzz}
              onPress={onClose}
              styles={styles}
            />
          );
        }}
        onSwipeableOpenStartDrag={swiping}
        onSwipeableWillOpen={() => {
          swiping();
          // Read as it is let go, before the row springs back to Close.
          if (-(offset.current?.value ?? 0) > width.value * FULL_SWIPE) onClose();
        }}
        onSwipeableOpen={() => setOpen(true)}
        onSwipeableWillClose={() => setOpen(false)}
      >
        {children}
      </Swipeable>
    </View>
  );
}

function CloseAction({
  translation,
  width,
  hidden,
  onFull,
  onPress,
  styles,
}: {
  translation: SharedValue<number>;
  width: SharedValue<number>;
  hidden: boolean;
  onFull: () => void;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  const theme = useTheme();
  useAnimatedReaction(
    () => width.value > 0 && -translation.value > width.value * FULL_SWIPE,
    (past, before) => {
      if (past && before === false) scheduleOnRN(onFull);
    },
  );
  return (
    <Pressable
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
      accessibilityRole="button"
      accessibilityLabel="Close conversation"
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
    >
      <CloseIcon color={theme.text} size={20} />
      <Text style={styles.label}>Close</Text>
    </Pressable>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    behind: {
      borderRadius: tokens.radiusMd,
      backgroundColor: theme.raised,
    },
    front: {
      backgroundColor: theme.surface,
    },
    action: {
      width: ACTION_WIDTH,
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
    },
    pressed: {
      opacity: 0.7,
    },
    label: {
      color: theme.text,
      fontSize: tokens.textSm,
    },
  });
}
