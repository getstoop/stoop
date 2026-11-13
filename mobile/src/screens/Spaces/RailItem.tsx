import { badgeCount } from "@stoop/core/unreads";
import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import SpaceIcon from "../../components/SpaceIcon";
import { type Theme, tokens, useTheme } from "../../theme";
import { RAIL_ITEM_HEIGHT, railItem } from "./railRules";

const ICON = 44;
const RING = 2;

// One space on the rail: its icon, with one mark at the rail's right
// edge, where the pane meets it (the accent bar, with a ring round the
// icon, while it is the space shown; on any other a small tab while
// something in it is unread), and its mention count on the icon's
// bottom-right corner (./railRules.ts has the rules). Nothing is drawn
// at the left edge. Pressed, the pane shows its channels. The mark is
// one shape that changes: the tab grows into the bar as its space is
// picked and shrinks back as another is, the ring fading with it, or
// both change at once under Reduce Motion.
export default function RailItem({
  space,
  selected,
  origin,
  token,
  onPress,
}: {
  space: Space;
  selected: boolean;
  origin: string;
  token: string;
  onPress: () => void;
}) {
  const styles = makeStyles(useTheme());
  const view = railItem(space, selected);
  const motion = { ...MOTION, transitionDuration: useReducedMotion() ? 0 : tokens.dur };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={view.label}
      testID={`space-${space.id}`}
      onPress={onPress}
      style={({ pressed }) => [styles.item, pressed && styles.pressed]}
    >
      <Animated.View style={[styles.mark, styles[view.mark], motion]} />
      <Animated.View style={[styles.ring, selected && styles.ringed, view.dimmed && styles.dimmed, motion]}>
        <SpaceIcon name={space.name} fileId={space.iconFileId} origin={origin} token={token} size={ICON} />
      </Animated.View>
      {view.mentions > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badgeCount(view.mentions)}</Text>
        </View>
      )}
    </Pressable>
  );
}

// What changes between a button's states, and how: the mark's place,
// size and colour, and the ring's colour.
const MOTION = {
  transitionProperty: ["top", "height", "backgroundColor", "borderColor"],
  transitionTimingFunction: "ease-out" as const,
};

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    item: {
      width: tokens.railW,
      height: RAIL_ITEM_HEIGHT,
      alignItems: "center",
      justifyContent: "center",
    },
    pressed: {
      opacity: 0.85,
    },
    // Flush with the rail's right edge, a point clear of the badge's
    // border beside it.
    mark: {
      position: "absolute",
      right: 0,
      width: 4,
      borderTopLeftRadius: tokens.radiusSm,
      borderBottomLeftRadius: tokens.radiusSm,
    },
    // Each centred on the button's 56; no mark is one shrunk to nothing
    // there, fading in whichever colour it had.
    selected: {
      top: 12,
      height: 32,
      backgroundColor: theme.accent,
    },
    unread: {
      top: 24,
      height: 8,
      backgroundColor: theme.text,
    },
    none: {
      top: 28,
      height: 0,
      backgroundColor: "transparent",
    },
    // The ring's room is always kept, so picking a space moves nothing.
    ring: {
      borderWidth: RING,
      borderRadius: tokens.radiusLg + RING,
      borderColor: "transparent",
    },
    ringed: {
      borderColor: theme.accent,
    },
    // A muted space's icon, its ring with it.
    dimmed: {
      opacity: 0.5,
    },
    // Over the icon's bottom-right corner, cut out of it by a border in
    // the rail's colour.
    badge: {
      position: "absolute",
      right: 5,
      bottom: 2,
      minWidth: 26,
      height: 22,
      paddingHorizontal: 4,
      borderWidth: 2,
      borderColor: theme.canvas,
      borderRadius: tokens.radiusPill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.accent,
    },
    badgeText: {
      color: theme.onAccent,
      fontSize: tokens.textXs,
      fontWeight: "700",
    },
  });
}
