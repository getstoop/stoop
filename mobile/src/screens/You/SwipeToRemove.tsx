import { type ReactNode, useRef } from "react";
import { StyleSheet } from "react-native";
import Swipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { type Theme, useTheme } from "../../theme";
import RemoveAction, { ACTION_WIDTH } from "./RemoveAction";

// A server's row that swipes left to show Remove, a shortcut for its
// menu's. It always rests open on Remove: taking a server off the phone
// is confirmed, so a long swipe does nothing more. One row rests open at
// a time (onSwipe).

export default function SwipeToRemove({
  name,
  children,
  onRemove,
  onSwipe,
}: {
  name: string;
  children: ReactNode;
  onRemove: () => void;
  onSwipe: (row: SwipeableMethods) => void;
}) {
  const styles = makeStyles(useTheme());
  const row = useRef<SwipeableMethods>(null);
  const swiping = () => {
    if (row.current) onSwipe(row.current);
  };

  return (
    <Swipeable
      ref={row}
      friction={1}
      rightThreshold={ACTION_WIDTH / 2}
      containerStyle={styles.behind}
      renderRightActions={(_progress, translation) => (
        <RemoveAction name={name} translation={translation} onPress={onRemove} />
      )}
      onSwipeableOpenStartDrag={swiping}
      onSwipeableWillOpen={swiping}
    >
      {children}
    </Swipeable>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    behind: {
      backgroundColor: theme.raised,
    },
  });
}
