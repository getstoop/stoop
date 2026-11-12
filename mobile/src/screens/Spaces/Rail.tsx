import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";
import { ScrollView, StyleSheet } from "react-native";
import { tokens } from "../../theme";
import RailItem from "./RailItem";
import { useBottomObstruction } from "./useBottomObstruction";

// The rail down the left of the Spaces tab: the current server's spaces,
// and only those, in the order the account joined them. It scrolls when
// they outgrow the screen, and its content is padded by what lies over
// the bottom of the screen (the tab bar on iOS), so the last space can
// always be brought clear of it and pressed. A tap on the status bar is
// left to the pane's list.
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
  const obstruction = useBottomObstruction();
  return (
    <ScrollView
      accessibilityLabel="Spaces"
      style={styles.rail}
      contentContainerStyle={[styles.content, { paddingBottom: RAIL_PADDING + obstruction }]}
      // The padding above is the whole inset: the system adds none.
      contentInsetAdjustmentBehavior="never"
      showsVerticalScrollIndicator={false}
      scrollsToTop={false}
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

const RAIL_PADDING = 8;

const styles = StyleSheet.create({
  rail: {
    flexGrow: 0,
    width: tokens.railW,
  },
  content: {
    paddingTop: RAIL_PADDING,
  },
});
