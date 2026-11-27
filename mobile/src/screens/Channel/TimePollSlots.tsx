import { parseLocalInput, zoneLabel } from "@stoop/core/dates";
import {
  addSlot,
  canAddSlot,
  canRemoveSlot,
  removeSlot,
  type SlotProblem,
  slotBounds,
  slotCount,
  slotProblemText,
  TIME_SLOTS_FULL,
  type TimePollForm,
  withSlot,
} from "@stoop/core/timePollForm";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AlertIcon, CloseIcon, GlobeIcon, PlusIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";
import ReminderDateTime, { type PickerMode } from "./ReminderDateTime";

// How long iOS's picker gets to be laid out before its row is brought
// into view anyway (the row's own layout usually comes first).
const REVEAL_DELAY_MS = 350;

// The times of the time poll's form (TimePollForm): "Times" with how
// many of ten, a row for each, its date and time on the system's pickers
// (ReminderDateTime, compact) and its remove button (off at two), Add
// time under them (off at ten, saying why), and the line naming the zone
// the times are read in. A row's problem (core/timePollForm
// checkTimePollForm) is said under it, and so is a row with a date and
// no time, or a time and no date (`halves`, the form's to hold, since
// the shared rules see such a row as empty): "Pick a date and a time.",
// once its own picker is closed. A row shown empty opens nothing by
// itself, and on iOS one picker is open across all the rows: opening
// another closes the one before.
export default function TimePollSlots({
  form,
  now,
  problems,
  halves,
  locked,
  onChange,
  onHalf,
  onReveal,
}: {
  form: TimePollForm;
  // The clock the rows' bounds and the zone are read at.
  now: Date;
  problems: Record<number, SlotProblem>;
  // The rows half picked, by key.
  halves: ReadonlySet<number>;
  // While the request is out: nothing changes.
  locked: boolean;
  onChange: (update: (form: TimePollForm) => TimePollForm) => void;
  onHalf: (key: number, half: boolean) => void;
  // Asks the form to scroll this stretch of the times into view (points
  // from the top of the times): a row whose iOS picker has opened.
  onReveal: (top: number, bottom: number) => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  // The one iOS picker open, by row.
  const [open, setOpen] = useState<{ key: number; mode: PickerMode } | null>(null);
  if (open && !form.slots.some((slot) => slot.key === open.key)) setOpen(null);
  // Where each row sits, and the row whose picker has just opened.
  const rows = useRef(new Map<number, { y: number; height: number }>());
  const revealing = useRef<number | null>(null);
  const reveal = (key: number) => {
    const row = rows.current.get(key);
    if (row) onReveal(row.y, row.y + row.height);
  };
  const pickerShown = (key: number) => {
    revealing.current = key;
    setTimeout(() => {
      if (revealing.current !== key) return;
      revealing.current = null;
      reveal(key);
    }, REVEAL_DELAY_MS);
  };
  const bounds = slotBounds(now);
  const min = parseLocalInput(bounds.min) ?? now;
  const max = parseLocalInput(bounds.max) ?? now;
  const removable = canRemoveSlot(form) && !locked;
  const addable = canAddSlot(form) && !locked;

  return (
    <View style={styles.group}>
      <View style={styles.head}>
        <Text style={styles.label}>Times</Text>
        <Text style={styles.count}>{slotCount(form)}</Text>
      </View>
      {form.slots.map((slot, index) => {
        const problem: SlotProblem | undefined =
          problems[slot.key] ?? (halves.has(slot.key) && open?.key !== slot.key ? "invalid" : undefined);
        return (
          <View
            key={slot.key}
            style={styles.slot}
            onLayout={(event) => {
              const { y, height } = event.nativeEvent.layout;
              rows.current.set(slot.key, { y, height });
              if (revealing.current !== slot.key) return;
              revealing.current = null;
              reveal(slot.key);
            }}
          >
            <ReminderDateTime
              custom={slot.value}
              bounds={{ min, max }}
              locked={locked}
              invalid={!!problem}
              onCustom={(value) => onChange((current) => withSlot(current, slot.key, value))}
              onPickerShown={() => pickerShown(slot.key)}
              onHalf={(half) => onHalf(slot.key, half)}
              testID={`time-slot-${index + 1}`}
              name={`Time ${index + 1}`}
              openAtStart={false}
              compact
              picker={{
                open: open?.key === slot.key ? open.mode : null,
                onOpen: (mode) => setOpen(mode ? { key: slot.key, mode } : null),
              }}
              after={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove time ${index + 1}`}
                  accessibilityState={{ disabled: !removable }}
                  disabled={!removable}
                  testID={`time-slot-${index + 1}-remove`}
                  onPress={() => onChange((current) => removeSlot(current, slot.key))}
                  style={({ pressed }) => [styles.remove, !removable && styles.off, pressed && styles.pressed]}
                >
                  <CloseIcon color={theme.textMuted} size={18} />
                </Pressable>
              }
            />
            {problem && (
              <View style={styles.said} accessible accessibilityRole="alert" accessibilityLabel={slotProblemText(problem)}>
                <View style={styles.saidMark}>
                  <AlertIcon color={theme.danger} />
                </View>
                <Text style={styles.error}>{slotProblemText(problem)}</Text>
              </View>
            )}
          </View>
        );
      })}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add time"
        accessibilityState={{ disabled: !addable }}
        accessibilityHint={canAddSlot(form) ? undefined : TIME_SLOTS_FULL}
        disabled={!addable}
        testID="time-poll-add"
        onPress={() => {
          setOpen(null);
          onChange(addSlot);
        }}
        style={({ pressed }) => [styles.add, !addable && styles.off, pressed && styles.pressed]}
      >
        <PlusIcon color={theme.text} size={18} />
        <Text style={styles.addText}>Add time</Text>
      </Pressable>
      {!canAddSlot(form) && <Text style={styles.note}>{TIME_SLOTS_FULL}</Text>}
      <View style={styles.zone}>
        <View style={styles.saidMark}>
          <GlobeIcon color={theme.textMuted} />
        </View>
        <Text style={styles.zoneText}>
          Times are in your time zone: {zoneLabel(now)}. Everyone sees them in their own.
        </Text>
      </View>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    group: {
      gap: 6,
    },
    head: {
      flexDirection: "row",
      justifyContent: "space-between",
    },
    label: {
      color: theme.textMuted,
      fontSize: tokens.textUi,
    },
    count: {
      color: theme.textMuted,
      fontSize: tokens.textSm,
    },
    slot: {
      gap: 4,
    },
    remove: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: tokens.radiusMd,
    },
    off: {
      opacity: tokens.disabled,
    },
    pressed: {
      backgroundColor: theme.hover,
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
    error: {
      flex: 1,
      color: theme.danger,
      fontSize: tokens.textSm,
      lineHeight: tokens.textSm * tokens.leadingUi,
    },
    add: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      minHeight: 48,
      marginTop: 2,
      borderRadius: tokens.radiusLg,
      backgroundColor: theme.raised,
    },
    addText: {
      color: theme.text,
      fontSize: tokens.textBody,
    },
    note: {
      color: theme.textMuted,
      fontSize: tokens.textSm,
    },
    zone: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 6,
      marginTop: 2,
    },
    zoneText: {
      flex: 1,
      color: theme.textMuted,
      fontSize: tokens.textSm,
      lineHeight: tokens.textSm * tokens.leadingUi,
    },
  });
}
