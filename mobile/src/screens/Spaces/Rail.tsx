import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";
import { type ComponentRef, useEffect, useRef } from "react";
import { type LayoutChangeEvent, ScrollView, StyleSheet } from "react-native";
import { tokens } from "../../theme";
import RailAdd from "./RailAdd";
import RailItem from "./RailItem";
import { RAIL_PADDING, railOffset, railReveal } from "./railRules";
import { useBottomObstruction } from "./useBottomObstruction";

// The rail down the left of the Spaces tab: the current server's spaces,
// and only those, in the order the account joined them, and after the
// last of them the button that adds one (./RailAdd.tsx). It scrolls when
// they outgrow the screen, and its content is padded by what lies over
// the bottom of the screen (the tab bar on iOS), so the last space can
// always be brought clear of it and pressed. As it first shows, it
// starts where the selected space is in sight (a remembered one can be
// far down), without animation; after that it is scrolled by hand, and
// on its own only when another space becomes the selected one out of
// sight (one joined from a link, or asked for from outside the tab),
// which it brings just into view. A tap on the status bar is left to
// the pane's list.
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
  // The rail's height and how far it is scrolled, as last told.
  const height = useRef(0);
  const scrolled = useRef(0);
  // Once, at the rail's first usable size: a later reload or resize
  // leaves the scroll where it is.
  const place = (event: LayoutChangeEvent) => {
    height.current = event.nativeEvent.layout.height;
    if (placed.current || height.current <= 0) return;
    placed.current = true;
    const index = spaces.findIndex((space) => space.id === selected);
    const offset = railOffset(index, spaces.length, height.current, obstruction);
    if (offset > 0) {
      scrolled.current = offset;
      rail.current?.scrollTo({ y: offset, animated: false });
    }
  };
  // When another space becomes the selected one, the rail shows it. Only
  // then: a reload that moves the selected space, or the server chip
  // coming or going, leaves a rail scrolled by hand where it is.
  const latest = useRef({ spaces, obstruction });
  latest.current = { spaces, obstruction };
  useEffect(() => {
    if (!placed.current) return;
    const index = latest.current.spaces.findIndex((space) => space.id === selected);
    const offset = railReveal(index, height.current, latest.current.obstruction, scrolled.current);
    if (offset !== null) rail.current?.scrollTo({ y: offset, animated: true });
  }, [selected]);
  return (
    <ScrollView
      ref={rail}
      onLayout={place}
      onScroll={(event) => {
        scrolled.current = event.nativeEvent.contentOffset.y;
      }}
      scrollEventThrottle={16}
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
