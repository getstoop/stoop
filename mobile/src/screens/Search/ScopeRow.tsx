import { Pressable, StyleSheet, Text, View } from "react-native";
import { type Theme, tokens, useTheme } from "../../theme";

// Under the header: the two chips that widen the search to the whole
// space or narrow it to the channel it started from (the in:#name
// filter in the field, core/search), the active one filled in the
// accent, and at the right how many matched, "4+ messages" while older
// matches may still be out there.
export default function ScopeRow({
  channelName,
  narrowed,
  count,
  onAll,
  onThis,
}: {
  // The channel the search started from; none, no chips.
  channelName?: string;
  narrowed: boolean;
  count: string;
  onAll: () => void;
  onThis: () => void;
}) {
  const styles = makeStyles(useTheme());
  return (
    <View style={styles.row}>
      {channelName && (
        <>
          <Chip label="All channels" active={!narrowed} onPress={onAll} />
          <Chip label="This channel" active={narrowed} onPress={onThis} />
        </>
      )}
      <Text style={styles.count}>{count}</Text>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const styles = makeStyles(useTheme());
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, active && styles.active, pressed && styles.down]}
    >
      <Text style={[styles.label, active && styles.activeLabel]}>{label}</Text>
    </Pressable>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    chip: {
      height: 32,
      paddingHorizontal: 12,
      borderRadius: tokens.radiusPill,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.panel,
      justifyContent: "center",
    },
    active: {
      borderColor: theme.accent,
      backgroundColor: theme.accentSoft,
    },
    down: {
      opacity: 0.85,
    },
    label: {
      color: theme.textMuted,
      fontSize: tokens.textUi,
      fontWeight: "600",
    },
    activeLabel: {
      color: theme.text,
    },
    count: {
      marginLeft: "auto",
      color: theme.textMuted,
      fontSize: tokens.textSm,
    },
  });
}
