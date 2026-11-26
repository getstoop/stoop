import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerChangeEvent,
} from "@react-native-community/datetimepicker";
import { localInputValue, parseLocalInput } from "@stoop/core/reminderForm";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Keyboard, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { type Theme, tokens, useTheme } from "../../theme";

// The picked date and time of a reminder's "Pick a date and time"
// (ReminderWhen): two fields side by side, the date and the time, each
// opening the system's own picker. On iOS the picker opens in the sheet
// under the fields (the calendar for the date, the wheels for the time),
// one at a time, a tap on its field again closing it; what it shows is
// what is picked, from the moment it opens. On Android each is the
// system's dialog, and a date picked with no time yet goes straight on
// to the time's. Shown with nothing picked, it opens the date's picker
// at once. The two make the form's value once both are picked, as a
// date-and-time field holds it in local time (core/reminderForm
// localInputValue); nothing here works in UTC or sends an instant. The
// date's picker is bounded by `bounds` (customBounds, a day wider than
// the server's own limits); the time's has no bounds, which would
// otherwise be read against a date it does not show.
//
// A time poll's form (TimePollSlots) has one pair per time, `compact`:
// the date without its year (unless it is another year's), the time
// with no mark and a fixed width, the row's remove button (`after`)
// beside them. There, a pair shown empty opens nothing by itself
// (`openAtStart`), and which picker is open is the form's (`picker`), so
// that on iOS only one is open across all its times.
export default function ReminderDateTime({
  custom,
  bounds,
  locked,
  invalid,
  onCustom,
  onPickerShown,
  testID = "reminder",
  name,
  openAtStart = true,
  compact = false,
  picker,
  after,
  onHalf,
}: {
  // The form's value, "2026-12-02T09:00", or "" for none yet.
  custom: string;
  bounds: { min: Date; max: Date };
  locked: boolean;
  // A time the server refused, or would: both fields are marked.
  invalid: boolean;
  onCustom: (value: string) => void;
  // iOS's picker has opened in the sheet, for the sheet to bring it into view.
  onPickerShown: () => void;
  // The fields' test ids are this with "-date" and "-time".
  testID?: string;
  // What a screen reader hears before each field's own name ("Time 2").
  name?: string;
  // Shown with nothing picked, the date's picker opens at once.
  openAtStart?: boolean;
  compact?: boolean;
  // iOS's open picker held by the form, for one across several pairs.
  picker?: { open: PickerMode | null; onOpen: (mode: PickerMode | null) => void };
  // Beside the fields, at the row's end.
  after?: ReactNode;
  // Whether one of the two is picked and not the other: a time poll's
  // row says so (the value stays "" until both are).
  onHalf?: (half: boolean) => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [parts, setParts] = useState(() => {
    const at = parseLocalInput(custom);
    return { day: at, time: at };
  });
  // The parts as last taken, for a dialog's answer, which comes to the
  // closure of the render that opened it (Android's date, then its time).
  const latest = useRef(parts);
  const [ownOpen, setOwnOpen] = useState<PickerMode | null>(null);
  const open = picker ? picker.open : ownOpen;
  const setOpen = picker ? picker.onOpen : setOwnOpen;
  const ios = Platform.OS === "ios";
  // With large text the fields go one above the other, and iOS's date
  // picker is the wheels, since its calendar no longer fits the sheet's
  // width.
  const large = useWindowDimensions().fontScale >= LARGE_TEXT;

  // A part picked: the form's value once both are.
  const take = (part: "day" | "time", value: Date) => {
    const next = { ...latest.current, [part]: value };
    latest.current = next;
    setParts(next);
    onHalf?.(!next.day !== !next.time);
    if (next.day && next.time) {
      onCustom(
        localInputValue(
          new Date(
            next.day.getFullYear(),
            next.day.getMonth(),
            next.day.getDate(),
            next.time.getHours(),
            next.time.getMinutes(),
          ),
        ),
      );
    }
    return next;
  };

  const openAndroid = (mode: "date" | "time", from: typeof parts) => {
    DateTimePickerAndroid.open({
      mode,
      value: (mode === "date" ? from.day : from.time) ?? defaultFor(mode),
      ...(mode === "date" ? { minimumDate: bounds.min, maximumDate: bounds.max } : {}),
      onValueChange: (_event: DateTimePickerChangeEvent, picked: Date) => {
        const next = take(mode === "date" ? "day" : "time", picked);
        if (mode === "date" && !next.time) openAndroid("time", next);
      },
    });
  };

  const show = (mode: "date" | "time") => {
    if (locked) return;
    Keyboard.dismiss();
    if (!ios) {
      openAndroid(mode, latest.current);
      return;
    }
    if (open === mode) {
      setOpen(null);
      return;
    }
    // What the picker shows is what is picked.
    const part = mode === "date" ? "day" : "time";
    if (!latest.current[part]) take(part, defaultFor(mode));
    setOpen(mode);
  };

  // Shown with nothing picked: the date's picker at once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, as it is first shown.
  useEffect(() => {
    if (openAtStart && !parts.day) show("date");
  }, []);
  // Said once as a picker opens, not again as the form draws while it is
  // open: the caller's function may be new on every draw.
  const pickerShown = useRef(onPickerShown);
  pickerShown.current = onPickerShown;
  useEffect(() => {
    if (open) pickerShown.current();
  }, [open]);
  // Android's dialogs are the system's: closed with the form.
  useEffect(
    () => () => {
      if (Platform.OS !== "android") return;
      DateTimePickerAndroid.dismiss("date").catch(() => {});
      DateTimePickerAndroid.dismiss("time").catch(() => {});
    },
    [],
  );

  const dateText = parts.day?.toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(!compact || parts.day.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
  });
  const named = name ? `${name}, ` : "";
  const timeText = parts.time?.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const shownValue = open === "date" ? (parts.day ?? defaultFor("date")) : (parts.time ?? defaultFor("time"));

  const fields = (
    <View style={[styles.fields, large && styles.stacked, !!after && styles.beside]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${named}Date, ${dateText ?? "not picked"}`}
        accessibilityHint={ios ? undefined : "Opens the date picker"}
        accessibilityState={{ disabled: locked, ...(ios ? { expanded: open === "date" } : {}) }}
        disabled={locked}
        testID={`${testID}-date`}
        onPress={() => show("date")}
        style={[
          styles.field,
          !large && (compact ? styles.dateCompact : styles.date),
          open === "date" && styles.fieldOpen,
          invalid && styles.fieldBad,
        ]}
      >
        <CalendarGlyph color={theme.textMuted} />
        <Text style={[styles.value, !dateText && styles.placeholder]} numberOfLines={1}>
          {dateText ?? "Date"}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${named}Time, ${timeText ?? "not picked"}`}
        accessibilityHint={ios ? undefined : "Opens the time picker"}
        accessibilityState={{ disabled: locked, ...(ios ? { expanded: open === "time" } : {}) }}
        disabled={locked}
        testID={`${testID}-time`}
        onPress={() => show("time")}
        style={[
          styles.field,
          !large && (compact ? styles.timeCompact : styles.time),
          open === "time" && styles.fieldOpen,
          invalid && styles.fieldBad,
        ]}
      >
        {!compact && <ClockGlyph color={theme.textMuted} />}
        <Text style={[styles.value, !timeText && styles.placeholder]} numberOfLines={1}>
          {timeText ?? "Time"}
        </Text>
      </Pressable>
    </View>
  );

  return (
    <View style={styles.wrap}>
      {after ? (
        <View style={styles.line}>
          {fields}
          {after}
        </View>
      ) : (
        fields
      )}
      {ios && open && !locked && (
        <DateTimePicker
          // One picker at a time, each made afresh for its mode.
          key={open}
          mode={open}
          display={open === "date" && !large ? "inline" : "spinner"}
          value={shownValue}
          {...(open === "date" ? { minimumDate: bounds.min, maximumDate: bounds.max } : {})}
          themeVariant={theme.scheme === "dark" ? "dark" : "light"}
          accentColor={theme.accent}
          textColor={theme.text}
          onValueChange={(_event, picked) => take(open === "date" ? "day" : "time", picked)}
          style={open === "date" ? styles.calendar : styles.wheels}
        />
      )}
    </View>
  );
}

export type PickerMode = "date" | "time";

// The text size from which the fields stack (LARGE_TEXT, above).
const LARGE_TEXT = 1.35;

// What a picker opens on with nothing picked: the next whole hour, and
// its day (tomorrow, from 23:00), so the two together are ahead.
function defaultFor(_mode: "date" | "time"): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0);
}

// The two fields' marks, as the design draws them, at 18 points.
function CalendarGlyph({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M5 6h14v14H5zM5 10h14M9 3v4M15 3v4" />
    </Svg>
  );
}

function ClockGlyph({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2" />
    </Svg>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    wrap: {
      gap: 6,
    },
    fields: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    stacked: {
      flexDirection: "column",
      flexWrap: "nowrap",
    },
    field: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: 48,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: tokens.radiusLg,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
    },
    // The date takes what the time leaves; with large text the two wrap.
    date: {
      flexGrow: 1,
      flexBasis: 180,
    },
    time: {
      flexGrow: 1,
      flexBasis: 120,
    },
    // A time poll's: the date takes what the time and remove leave.
    dateCompact: {
      flexGrow: 1,
      flexShrink: 1,
      minWidth: 0,
    },
    // A time poll's: as wide as "12:30 PM", wider with larger text, the
    // text centred.
    timeCompact: {
      minWidth: 104,
      flexShrink: 0,
      justifyContent: "center",
    },
    // The fields and what sits beside them (`after`), on one line.
    line: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    beside: {
      flex: 1,
      minWidth: 0,
      flexWrap: "nowrap",
    },
    fieldOpen: {
      borderColor: theme.accent,
    },
    fieldBad: {
      borderColor: theme.danger,
    },
    value: {
      flexShrink: 1,
      color: theme.text,
      fontSize: 16,
    },
    placeholder: {
      color: theme.textMuted,
    },
    calendar: {
      alignSelf: "stretch",
    },
    wheels: {
      alignSelf: "center",
    },
  });
}
