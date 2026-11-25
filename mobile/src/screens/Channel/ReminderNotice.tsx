import {
  REMINDER_ALREADY_POSTED,
  REMINDER_NO_LONGER_WAITING,
  REMINDER_NOTICE_AFTER_MS,
  REMINDER_NOTICE_MS,
  REMINDER_REMOVED,
  REMINDER_UNDO_FAILED,
  reminderSetText,
} from "@stoop/core/reminderForm";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { type SetReminder, type UndoOutcome } from "../../api/reminders";
import { CheckIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";

// A reminder just set, as its notice shows it: where names the channel or
// conversation it posts in when the notice is shown away from there
// (core/reminderForm reminderPlace).
export type ShownReminder = SetReminder & { where?: string };

// set: just set, Undo offered. undoing: the first Undo is out. failed:
// an Undo failed, Undo offered again. retrying: a later Undo is out.
// Then removed, posted (not found on the first try), or gone (not found
// after a failed try, which may have taken it back itself).
type Phase = "set" | "undoing" | "failed" | "retrying" | "removed" | "posted" | "gone";

// How often a notice whose time is up asks again whether it is still
// held (touched, or its Undo out).
const RECHECK_MS = 1000;

// The notice after a reminder is set (docs/architecture/web.md →
// Reminders, Transient notices, as mobile draws it): a line over the
// composer with the time as the server stored it and Undo, an icon
// button named "Undo". It goes on its own after about six seconds, not
// while a finger is on it or Undo is out. Undo takes the reminder back
// (undo, DeleteReminder) and the notice then says so for a moment; if
// the reminder was posted meanwhile, it says that; if Undo fails, it says
// so and Undo stays. A screen reader is told each new line once, as it
// comes; the line itself is not a live region, so it is not said twice.
// The screen places it under the composer's lists and keeps it off the
// composer (ComposerDock), and takes it away on a channel change. After
// it has gone there is no way back to the reminder before it is posted.
export default function ReminderNotice({
  set,
  undo,
  onDone,
}: {
  set: ShownReminder;
  undo: (id: string) => Promise<UndoOutcome>;
  onDone: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [phase, setPhase] = useState<{ id: string; phase: Phase } | null>(null);
  // A phase belongs to the reminder it was reached for; a new one starts
  // at "set".
  const now = phase?.id === set.id ? phase.phase : "set";
  const shown = content(set, now);
  const touching = useRef(false);
  const held = useRef(false);
  held.current = !!shown.hold;
  const doneLatest = useRef(onDone);
  doneLatest.current = onDone;

  // Told once per line: a retry keeps the failed line's key, and so is
  // not said again.
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(shown.text);
  }, [shown.key]);

  // Its time, from when each line came; asked again while it is held.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const up = () => {
      if (touching.current || held.current) timer = setTimeout(up, RECHECK_MS);
      else doneLatest.current();
    };
    timer = setTimeout(up, shown.ms);
    return () => clearTimeout(timer);
  }, [shown.key, shown.ms]);

  const press = async () => {
    const { id } = set;
    const retry = now === "failed";
    setPhase({ id, phase: retry ? "retrying" : "undoing" });
    const outcome = await undo(id);
    const reached: Phase = outcome === "notFound" ? (retry ? "gone" : "posted") : outcome;
    // An answer for a reminder whose notice has since given way to a
    // newer one's is dropped.
    setPhase((current) => (current?.id === id ? { id, phase: reached } : current));
  };

  return (
    <View
      style={styles.notice}
      testID="reminder-notice"
      onTouchStart={() => {
        touching.current = true;
      }}
      onTouchEnd={() => {
        touching.current = false;
      }}
      onTouchCancel={() => {
        touching.current = false;
      }}
    >
      {shown.check && (
        <View style={styles.mark}>
          <CheckIcon color={theme.ok} size={16} />
        </View>
      )}
      <Text style={styles.text}>{shown.text}</Text>
      {shown.undo && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Undo"
          accessibilityState={{ busy: shown.busy, disabled: shown.busy }}
          disabled={shown.busy}
          testID="reminder-undo"
          hitSlop={4}
          onPress={press}
          style={({ pressed }) => [styles.undo, pressed && styles.undoPressed]}
        >
          {shown.busy ? (
            <ActivityIndicator size="small" color={theme.textMuted} />
          ) : (
            <UndoGlyph color={theme.text} />
          )}
        </Pressable>
      )}
    </View>
  );
}

type Shown = {
  key: string;
  text: string;
  check?: boolean;
  undo?: boolean;
  busy?: boolean;
  ms: number;
  hold?: boolean;
};

function content(set: ShownReminder, phase: Phase): Shown {
  switch (phase) {
    case "removed":
      return { key: `${set.id}-removed`, text: REMINDER_REMOVED, check: true, ms: REMINDER_NOTICE_AFTER_MS };
    case "posted":
    case "gone":
      return {
        key: `${set.id}-${phase}`,
        text: phase === "posted" ? REMINDER_ALREADY_POSTED : REMINDER_NO_LONGER_WAITING,
        ms: REMINDER_NOTICE_MS,
      };
    case "failed":
    case "retrying":
      // One key for both, so a retry neither says it again nor restarts
      // the time.
      return {
        key: `${set.id}-failed`,
        text: REMINDER_UNDO_FAILED,
        undo: true,
        busy: phase === "retrying",
        ms: REMINDER_NOTICE_MS,
        hold: phase === "retrying",
      };
    case "set":
    case "undoing":
      return {
        key: `${set.id}-set`,
        text: reminderSetText(set.remindAt, new Date(), set.where),
        check: true,
        undo: true,
        busy: phase === "undoing",
        ms: REMINDER_NOTICE_MS,
        hold: phase === "undoing",
      };
  }
}

// Web's Undo: an arrow turning back.
function UndoGlyph({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M9 14 4 9l5-5" />
      <Path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </Svg>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    // As the channel's refusal line (ComposerDock), with Undo at its end.
    notice: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 52,
      paddingLeft: 14,
      paddingRight: 4,
      paddingVertical: 4,
      borderRadius: tokens.radiusMd,
      backgroundColor: theme.panel,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      boxShadow: theme.scheme === "dark" ? "0 6px 20px rgba(0, 0, 0, 0.35)" : "0 6px 20px rgba(30, 25, 20, 0.16)",
    },
    mark: {
      flex: 0,
    },
    text: {
      flex: 1,
      paddingVertical: 8,
      color: theme.text,
      fontSize: tokens.textUi,
      fontWeight: "600",
      lineHeight: tokens.textUi * tokens.leadingUi,
    },
    undo: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      backgroundColor: theme.raised,
    },
    undoPressed: {
      backgroundColor: theme.hover,
    },
  });
}
