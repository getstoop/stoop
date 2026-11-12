import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";
import { ScrollView, StyleSheet } from "react-native";
import { tokens } from "../../theme";
import RailItem from "./RailItem";

// The rail down the left of the Spaces tab: the current server's spaces,
// and only those, in the order the account joined them. It scrolls when
// they outgrow the screen. On iOS the tab bar lies over the bottom of
// the screen, so the system insets the scroll by it and the last space
// scrolls clear; Android's bar sits below the screen.
export default function Rail({
  spaces,
  selected,
  origin,
  token,
  onSelect,
}: {
  spaces: Space[];
  selected: string | undefined;
  origin: string;
  token: string;
  onSelect: (spaceId: string) => void;
}) {
  return (
    <ScrollView
      style={styles.rail}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
    >
      {spaces.map((space) => (
        <RailItem
          key={space.id}
          space={space}
          selected={space.id === selected}
          origin={origin}
          token={token}
          onPress={() => onSelect(space.id)}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  rail: {
    flexGrow: 0,
    width: tokens.railW,
  },
  content: {
    paddingVertical: 8,
  },
});
