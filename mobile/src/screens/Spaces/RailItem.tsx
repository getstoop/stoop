import { badgeCount } from "@stoop/core/unreads";
import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";
import { Pressable, StyleSheet, Text, View } from "react-native";
import SpaceIcon from "../../components/SpaceIcon";
import { type Theme, tokens, useTheme } from "../../theme";
import { RAIL_ITEM_HEIGHT, railItem } from "./railRules";

const ICON = 44;
const RING = 2;

// One space on the rail: its icon, ringed with a bar at the rail's left
// edge while it is the one shown; a small tab at the rail's right edge,
// where the pane meets it, while something in it is unread, as web's
// rail has it, longer on the selected space; and its mention count on
// the icon's bottom-right corner (./railRules.ts has the rules).
// Pressed, the pane shows its channels.
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

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={view.label}
      testID={`space-${space.id}`}
      onPress={onPress}
      style={({ pressed }) => [styles.item, pressed && styles.pressed]}
    >
      {view.selected && <View style={styles.bar} />}
      {view.unread && <View style={[styles.unread, view.selected && styles.unreadSelected]} />}
      <View style={[styles.ring, view.selected && styles.ringed, view.dimmed && styles.dimmed]}>
        <SpaceIcon name={space.name} fileId={space.iconFileId} origin={origin} token={token} size={ICON} />
      </View>
      {view.mentions > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badgeCount(view.mentions)}</Text>
        </View>
      )}
    </Pressable>
  );
}

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
    // Each of the three centred on the button's 56.
    bar: {
      position: "absolute",
      left: 0,
      top: 12,
      width: 4,
      height: 32,
      borderTopRightRadius: tokens.radiusSm,
      borderBottomRightRadius: tokens.radiusSm,
      backgroundColor: theme.accent,
    },
    // Flush with the rail's right edge, a point clear of the badge's
    // border beside it.
    unread: {
      position: "absolute",
      right: 0,
      top: 24,
      width: 4,
      height: 8,
      borderTopLeftRadius: tokens.radiusSm,
      borderBottomLeftRadius: tokens.radiusSm,
      backgroundColor: theme.text,
    },
    unreadSelected: {
      top: 18,
      height: 20,
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
