import type { ReactNode } from "react";
import { Text } from "react-native";
import type { Styles } from "./styles";

// A spoiler: its words on the spoiler fill, unreadable until revealed
// (onReveal, a tap), then readable on the same fill. A screen reader is
// told what it is by the message's label (MessageBody). The span has no
// role: iOS reads a tappable span out as its words, and React Native
// makes one a link unless told otherwise.
export default function Spoiler({
  covered,
  styles,
  onReveal,
  onLongPress,
  children,
}: {
  covered: boolean;
  styles: Styles;
  onReveal?: () => void;
  onLongPress?: () => void;
  children: ReactNode;
}) {
  return (
    <Text
      style={covered ? styles.covered : styles.revealed}
      accessibilityRole="none"
      onPress={onReveal}
      onLongPress={onReveal ? onLongPress : undefined}
    >
      {children}
    </Text>
  );
}
