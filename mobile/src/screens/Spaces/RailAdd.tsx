import { Pressable, StyleSheet, View } from "react-native";
import { SpacesAddIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";
import { RAIL_ITEM_HEIGHT, RAIL_RULE_HEIGHT } from "./railRules";

const TILE = 44;

// Add a space, the rail's last button: under a hairline that sets it
// apart from the spaces (none when there are no spaces), a dashed tile
// the size of a space's icon. It opens the sheet and is never the
// selected one, so it carries no bar, ring or badge.
export default function RailAdd({ ruled, onPress }: { ruled: boolean; onPress: () => void }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  return (
    <>
      {ruled && (
        <View style={styles.rule}>
          <View style={styles.line} />
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add a space"
        testID="add-space"
        onPress={onPress}
        style={({ pressed }) => [styles.item, pressed && styles.pressed]}
      >
        <View style={styles.tile}>
          <SpacesAddIcon color={theme.textMuted} />
        </View>
      </Pressable>
    </>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    rule: {
      width: tokens.railW,
      height: RAIL_RULE_HEIGHT,
      alignItems: "center",
      justifyContent: "center",
    },
    line: {
      width: 28,
      height: 1,
      backgroundColor: theme.border,
    },
    item: {
      width: tokens.railW,
      height: RAIL_ITEM_HEIGHT,
      alignItems: "center",
      justifyContent: "center",
    },
    pressed: {
      opacity: 0.6,
    },
    tile: {
      width: TILE,
      height: TILE,
      borderRadius: tokens.radiusLg,
      borderWidth: 1.5,
      borderStyle: "dashed",
      borderColor: theme.textMuted,
      alignItems: "center",
      justifyContent: "center",
    },
  });
}
