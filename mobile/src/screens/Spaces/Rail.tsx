import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";
import { type ComponentRef, useRef } from "react";
import { type LayoutChangeEvent, ScrollView, StyleSheet } from "react-native";
import { tokens } from "../../theme";
import RailAdd from "./RailAdd";
import RailItem from "./RailItem";
import { RAIL_PADDING, railOffset } from "./railRules";
import { useBottomObstruction } from "./useBottomObstruction";

// The rail down the left of the Spaces tab: the current server's spaces,
// and only those, in the order the account joined them, and after the
// last of them the button that adds one (./RailAdd.tsx). It scrolls when
// they outgrow the screen, and its content is padded by what lies over
// the bottom of the screen (the tab bar on iOS), so the last space can
// always be brought clear of it and pressed. As it first shows, it
// starts where the selected space is in sight (a remembered one can be
// far down), without animation; after that it is only ever scrolled by
// hand. A tap on the status bar is left to the pane's list.
export default function Rail({
  spaces,
  selected,
  origin,
  token,
  onSelect,
  onAdd,
}: {
  spaces: Space[];
  selected: string | undefined;
  origin: string;
  token: string;
  onSelect: (spaceId: string) => void;
  onAdd: () => void;
}) {
  const obstruction = useBottomObstruction();
  const rail = useRef<ComponentRef<typeof ScrollView>>(null);
  const placed = useRef(false);
  // Once, at the rail's first usable size: a later reload, pick or
  // resize leaves the scroll where it is.
  const place = (event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    if (placed.current || height <= 0) return;
    placed.current = true;
    const index = spaces.findIndex((space) => space.id === selected);
    const offset = railOffset(index, spaces.length, height, obstruction);
    if (offset > 0) rail.current?.scrollTo({ y: offset, animated: false });
  };
  return (
    <ScrollView
      ref={rail}
      onLayout={place}
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
      <RailAdd ruled={spaces.length > 0} onPress={onAdd} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  rail: {
    flexGrow: 0,
    width: tokens.railW,
  },
  content: {
    paddingTop: RAIL_PADDING,
  },
});
