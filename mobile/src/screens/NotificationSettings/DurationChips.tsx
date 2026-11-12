import { DND_DURATIONS } from "@stoop/core/doNotDisturb";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { DndDuration } from "../../dnd/switch";
import { type Theme, tokens, useTheme } from "../../theme";

// How long do not disturb lasts, one of web's list. Picking one counts
// from now, the one already picked included.
export default function DurationChips({
  picked,
  onPick,
}: {
  picked: DndDuration;
  onPick: (duration: DndDuration) => void;
}) {
  const styles = makeStyles(useTheme());
  return (
    <View accessibilityRole="radiogroup" style={styles.chips}>
      {DND_DURATIONS.map(({ key, label }) => {
        const checked = key === picked;
        return (
          <Pressable
            key={key}
            accessibilityRole="radio"
            accessibilityState={{ checked }}
            testID={`dnd-duration-${key}`}
            onPress={() => onPick(key)}
            style={styles.target}
          >
            {({ pressed }) => (
              <View style={[styles.chip, checked && styles.checked, pressed && styles.pressed]}>
                <Text style={[styles.label, checked && styles.checkedLabel]}>{label}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    // Each chip's target is taller than its pill, so the rows of targets
    // touch: the room above and below is taken back here.
    chips: {
      flexDirection: "row",
      flexWrap: "wrap",
      columnGap: 8,
      marginTop: -5,
      paddingHorizontal: 14,
      paddingBottom: 9,
    },
    // 44 high to tap, around a pill of 34.
    target: {
      justifyContent: "center",
      height: 44,
    },
    chip: {
      justifyContent: "center",
      height: 34,
      paddingHorizontal: 12,
      borderRadius: tokens.radiusPill,
      borderWidth: 1,
      borderColor: theme.border,
    },
    checked: {
      borderColor: theme.accent,
      backgroundColor: theme.accentSoft,
    },
    pressed: {
      opacity: 0.85,
    },
    label: {
      color: theme.text,
      fontSize: tokens.textUi,
    },
    checkedLabel: {
      fontWeight: "600",
    },
  });
}
