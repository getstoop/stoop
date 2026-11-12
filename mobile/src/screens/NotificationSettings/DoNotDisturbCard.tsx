import { shortDateTime } from "@stoop/core/dates";
import { StyleSheet, Text, View } from "react-native";
import { useDndSwitch } from "../../dnd/DndProvider";
import { type DndSwitch, FIRST_DURATION } from "../../dnd/switch";
import { type Theme, tokens, useTheme } from "../../theme";
import DurationChips from "./DurationChips";
import SwitchRow from "./SwitchRow";

// The phone's do not disturb: one switch for every server on it, with
// how long it lasts once on. A change shows at once and each server is
// told behind it; one that can't be reached stays as it was
// (src/dnd/store.ts).
export default function DoNotDisturbCard() {
  const styles = makeStyles(useTheme());
  const [dnd, change] = useDndSwitch();
  return (
    <View style={styles.section}>
      <View style={styles.card}>
        <SwitchRow
          label="Do not disturb"
          detail={status(dnd)}
          strong
          value={dnd.on}
          testID="dnd-switch"
          onValueChange={(on) => change(on ? FIRST_DURATION : "off")}
        />
        {dnd.on && <DurationChips picked={dnd.duration} onPick={change} />}
      </View>
      <Text style={styles.caption}>Holds every alert on every device, on all your servers.</Text>
    </View>
  );
}

function status(dnd: DndSwitch): string {
  if (!dnd.on) return "Off";
  return dnd.until === null ? "On" : `On until ${shortDateTime(new Date(dnd.until))}`;
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    section: {
      gap: 6,
    },
    card: {
      borderRadius: tokens.radiusLg,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.panel,
      overflow: "hidden",
    },
    caption: {
      marginHorizontal: 4,
      color: theme.textMuted,
      fontSize: tokens.textSm,
      lineHeight: tokens.textSm * tokens.leadingUi,
    },
  });
}
