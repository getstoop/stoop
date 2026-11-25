import { futureDay, futureTime } from "@stoop/core/dates";
import {
  customBounds,
  parseLocalInput,
  presetLabel,
  presetTime,
  REMINDER_CUSTOM_HINT,
  REMINDER_PRESETS,
  type ReminderChoice,
  type ReminderForm,
  type ReminderPreset,
} from "@stoop/core/reminderForm";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { CheckIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";
import ReminderDateTime from "./ReminderDateTime";

// When, in the reminder's form (ReminderForm), as web's WhenField: one
// choice of the four presets, each with the time it lands on by this
// device's clock (a guide: the server's clock decides), and "Pick a date
// and time", which shows a date field and a time field under it
// (ReminderDateTime). Nothing is chosen at first. Under the group, in
// words: the server's refusal of a time (problem), or this device's
// caution about a picked one, which stops nothing, or the hint. A screen
// reader hears the group as radio buttons, the chosen one selected, and
// a problem or caution as it appears.
export default function ReminderWhen({
  form,
  now,
  problem,
  caution,
  locked,
  onChoice,
  onCustom,
  onPickerShown,
}: {
  form: ReminderForm;
  now: Date;
  problem: string | null;
  caution: string | null;
  locked: boolean;
  onChoice: (choice: ReminderChoice) => void;
  onCustom: (value: string) => void;
  onPickerShown: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const custom = form.choice === "custom";
  const bounds = customBounds(now);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>When</Text>
      <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel="When">
        {REMINDER_PRESETS.map((preset) => (
          <Option
            key={preset}
            label={presetLabel(preset)}
            lands={lands(preset, now)}
            on={form.choice === preset}
            locked={locked}
            onPress={() => onChoice(preset)}
            styles={styles}
            theme={theme}
          />
        ))}
        <Option
          label="Pick a date and time"
          on={custom}
          locked={locked}
          onPress={() => onChoice("custom")}
          styles={styles}
          theme={theme}
        />
      </View>
      {custom && (
        <ReminderDateTime
          custom={form.custom}
          bounds={{
            min: parseLocalInput(bounds.min) ?? now,
            max: parseLocalInput(bounds.max) ?? now,
          }}
          locked={locked}
          invalid={!!problem}
          onCustom={onCustom}
          onPickerShown={onPickerShown}
        />
      )}
      {problem ? (
        <Said text={problem} tone="danger" styles={styles} theme={theme} />
      ) : custom && caution ? (
        <Said text={caution} tone="warn" styles={styles} theme={theme} />
      ) : (
        custom && <Text style={styles.hint}>{REMINDER_CUSTOM_HINT}</Text>
      )}
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

// What a preset row says on its right: the time it lands on, worded as a
// future time ("Today at 4:30 PM"); tomorrow's row names the hour already,
// so it says the day.
function lands(preset: ReminderPreset, now: Date): string {
  const at = presetTime(preset, now);
  const words = preset === "tomorrow" ? futureDay(at, now) : futureTime(at, now);
  return words[0].toUpperCase() + words.slice(1);
}

// One choice: the whole width, a round mark ticked in the accent when
// chosen, the label, and where it lands at its end.
function Option({
  label,
  lands,
  on,
  locked,
  onPress,
  styles,
  theme,
}: {
  label: string;
  lands?: string;
  on: boolean;
  locked: boolean;
  onPress: () => void;
  styles: Styles;
  theme: Theme;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={lands ? `${label}, ${lands}` : label}
      accessibilityState={{ checked: on, selected: on, disabled: locked }}
      disabled={locked}
      onPress={onPress}
      style={({ pressed }) => [styles.option, on && styles.optionOn, pressed && styles.pressed]}
    >
      <View style={[styles.mark, on && styles.markOn]}>{on && <CheckIcon color={theme.onAccent} size={13} />}</View>
      <Text style={styles.optionLabel}>{label}</Text>
      {lands && <Text style={styles.lands}>{lands}</Text>}
    </Pressable>
  );
}

// A refusal or a caution under the group, with its mark; said by a
// screen reader as it appears.
function Said({
  text,
  tone,
  styles,
  theme,
}: {
  text: string;
  tone: "danger" | "warn";
  styles: Styles;
  theme: Theme;
}) {
  const color = tone === "danger" ? theme.danger : theme.warn;
  return (
    <View style={styles.said} accessible accessibilityRole="alert" accessibilityLiveRegion="polite" accessibilityLabel={text}>
      <View style={styles.saidMark}>
        <AlertGlyph color={color} />
      </View>
      <Text style={[styles.saidText, { color }]}>{text}</Text>
    </View>
  );
}

// A circle with "!" in it, as web's error line draws it.
function AlertGlyph({ color }: { color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 8v5M12 16h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18" />
    </Svg>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    field: {
      gap: 6,
    },
    label: {
      color: theme.textMuted,
      fontSize: tokens.textUi,
    },
    options: {
      gap: 6,
    },
    option: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 48,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: tokens.radiusLg,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
    },
    optionOn: {
      borderColor: theme.accent,
    },
    pressed: {
      backgroundColor: theme.raised,
    },
    mark: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      borderColor: theme.textMuted,
      alignItems: "center",
      justifyContent: "center",
    },
    markOn: {
      borderColor: theme.accent,
      backgroundColor: theme.accent,
    },
    optionLabel: {
      flex: 1,
      color: theme.text,
      fontSize: 16,
    },
    lands: {
      color: theme.textMuted,
      fontSize: tokens.textSm,
      textAlign: "right",
    },
    hint: {
      color: theme.textMuted,
      fontSize: tokens.textSm,
    },
    said: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 6,
    },
    // On the first line of the words.
    saidMark: {
      paddingTop: 1,
    },
    saidText: {
      flex: 1,
      fontSize: tokens.textSm,
      lineHeight: tokens.textSm * tokens.leadingUi,
    },
  });
}
