import { Pressable, ScrollView, Text, View } from "react-native";
import type { Styles } from "./styles";

// A code block, as web's pre: its text exactly as written (no mention,
// @channel, link or mark) in monospace on the raised fill, never wrapped,
// scrolling sideways. React Native's Text, not our native view, which
// only lays out at a width; there are no pills or spoilers to draw here.
//
// The row's long press is taken inside the scroll, by its own Pressable:
// on iOS a ScrollView won't start its drag while one of its ancestors
// (the row) holds the touch. An upward drag on it is the list's. That
// Pressable is no element of its own on either platform (nor anything a
// screen reader could activate): the Text is the one element, read as
// the code.
export default function CodeBlock({
  text,
  styles,
  onLongPress,
}: {
  text: string;
  styles: Styles;
  onLongPress?: () => void;
}) {
  return (
    <View style={styles.pre}>
      <ScrollView horizontal contentContainerStyle={styles.preScroll} testID="code-block">
        <Pressable
          onLongPress={onLongPress}
          accessible={false}
          focusable={false}
          importantForAccessibility="no"
          style={styles.preContent}
        >
          <Text style={styles.preText} accessible>
            {text}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
