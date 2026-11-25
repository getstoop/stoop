import {
  checkReminderForm,
  deviceTimeZone,
  newReminderForm,
  REMINDER_TEXT_MAX,
  type ReminderRefusal,
  type ReminderRequest,
  reminderRefusal,
  reminderRequest,
  reminderTextProblemText,
  reminderTimeProblemText,
  withChoice,
  withCustom,
  withText,
} from "@stoop/core/reminderForm";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  TextInput,
  type TextInputInstance,
  useWindowDimensions,
  View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type SetReminder, saidByServer } from "../../api/reminders";
import SheetFrame from "../../components/SheetFrame";
import { useKeyboardHeight } from "../../hooks/useKeyboardHeight";
import { useSheet } from "../../hooks/useSheet";
import { type Theme, tokens, useTheme } from "../../theme";
import EdgeFade from "./EdgeFade";
import ReminderWhen from "./ReminderWhen";

// What the sheet leaves above itself, over the keyboard, of the channel.
const ABOVE = 48;
// How long after the modal shows the text takes the caret (PollForm).
const FOCUS_DELAY_MS = 300;
// How tall the fade the fields scroll under is, above Set reminder.
const FADE = 24;
// How often the times the presets land on are worked out again while the
// sheet is up, so what they say keeps up with the clock (web's form).
const TICK_MS = 15_000;
// How long a picker opened in the sheet is given to be laid out, and the
// sheet to grow, before the fields are scrolled to it.
const REVEAL_DELAY_MS = 250;

// Setting a reminder, from Reminder in the attach sheet or /remind in the
// composer (docs/architecture/messaging.md → Reminders, Slash commands):
// a sheet over a scrim, as the poll's form is (PollForm), with "Set a
// reminder" and Cancel, where it posts, the text, and When
// (ReminderWhen). The rules are web's, shared (core/reminderForm): Set
// reminder is on with some text and a preset, or a real picked date and
// time; a picked time this device's clock reads as gone by, under a
// minute or over a year away is a caution that stops nothing, since the
// server's clock decides. The request is made as Set is pressed, from
// the form as it is then and the device's time zone, and names a preset
// or the picked wall-clock time, never an instant. While it is out Set
// reads "Setting…" and the fields are locked. Once the server has it the
// sheet goes and the screen shows its notice (onSet), with the time the
// server answered; a refusal is said on the field it is about, or over
// Set, everything kept. Cancel still works while the request is out: the
// reminder is then the server's to set or refuse, and either is still
// said, by the screen (onSet, onLateFailure), so one is never set
// without a word. Cancel, a tap on the scrim, a swipe down from the top
// or Android's back closes it with nothing set.
export default function ReminderForm({
  channelId,
  where,
  text: startText = "",
  create,
  onSet,
  onLateFailure,
  onClose,
}: {
  channelId: string;
  // The channel it posts in, as the subtitle names it ("#game-night");
  // null for a conversation.
  where: string | null;
  // The text it opens with: the words typed after /remind.
  text?: string;
  create: (request: ReminderRequest, shown: Date) => Promise<SetReminder>;
  // Set, whether or not the sheet is still up.
  onSet: (set: SetReminder) => void;
  // Refused after the sheet had gone.
  onLateFailure: (err: unknown) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const window = useWindowDimensions();
  const shown = useSharedValue(0);
  const sheet = useSheet(shown, onClose);
  const { dismiss, closing, hold, fade } = sheet;
  const [form, setForm] = useState(() => newReminderForm(startText));
  // Opened with words: When is next, so the keyboard stays down.
  const [startsFilled] = useState(form.text !== "");
  const [now, setNow] = useState(() => new Date());
  const [setting, setSetting] = useState(false);
  const [failure, setFailure] = useState<ReminderRefusal | null>(null);
  const [focused, setFocused] = useState(false);
  const input = useRef<TextInputInstance>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  const [shownHeight, setShownHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const overflows = contentHeight > shownHeight + 1;
  // Whether the sheet is still there to say what became of the request.
  const mounted = useRef(true);
  // The guard against a second request, set at once.
  const settingNow = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const tick = setInterval(() => setNow(new Date()), TICK_MS);
    return () => {
      mounted.current = false;
      clearInterval(tick);
    };
  }, []);
  const check = checkReminderForm(form, now);

  const change = (update: (current: typeof form) => typeof form) => {
    if (setting) return;
    setFailure(null);
    setForm(update);
    setNow(new Date());
  };

  const set = async () => {
    if (settingNow.current || closing()) return;
    // The request as the form is now, judged again at this moment.
    const sentAt = new Date();
    const request = reminderRequest(form, channelId, sentAt, deviceTimeZone());
    setNow(sentAt);
    const at = checkReminderForm(form, sentAt).at;
    if (!request || !at) return;
    settingNow.current = true;
    setSetting(true);
    setFailure(null);
    let answer: SetReminder;
    try {
      answer = await create(request, at);
    } catch (err) {
      settingNow.current = false;
      if (!mounted.current || closing()) {
        onLateFailure(err);
        return;
      }
      setFailure(reminderRefusal(saidByServer(err)));
      setSetting(false);
      return;
    }
    onSet(answer);
    if (mounted.current && !closing()) dismiss();
  };

  // iOS's picker opened under the fields: brought into view once it has
  // been laid out, which grows the fields.
  const revealPicker = useRef(false);
  const showPicker = useCallback(() => {
    revealPicker.current = true;
    setTimeout(() => {
      // Used once, whichever comes first, so a later change of size
      // (an error line) does not scroll the fields to their end.
      if (!revealPicker.current) return;
      revealPicker.current = false;
      scroll.current?.scrollToEnd({ animated: true });
    }, REVEAL_DELAY_MS);
  }, []);

  const bottom = keyboard > 0 ? 8 : Math.max(insets.bottom, 8) + 8;
  const most = window.height - keyboard - insets.top - ABOVE;
  const settable = check.canSet && !setting;
  const textProblem =
    failure?.field === "text" ? failure.text : check.text ? reminderTextProblemText(check.text) : null;
  const whenProblem = failure?.field === "when" ? failure.text : null;
  const whenCaution = check.when ? reminderTimeProblemText(check.when) : null;

  return (
    <Modal
      transparent
      visible
      animationType="none"
      onRequestClose={dismiss}
      // The text takes the caret once the modal is up, a moment after
      // (PollForm says why); not when /remind filled it.
      onShow={() => {
        if (!startsFilled) setTimeout(() => input.current?.focus(), FOCUS_DELAY_MS);
      }}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <GestureHandlerRootView style={styles.fill} onAccessibilityEscape={dismiss}>
        <Animated.View style={[styles.scrim, fade]} pointerEvents="none" />
        <Pressable
          style={styles.fill}
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={dismiss}
          testID="reminder-form-close"
        />
        <View style={{ marginBottom: keyboard }}>
          <SheetFrame
            sheet={sheet}
            style={[styles.sheet, { maxHeight: most, paddingBottom: bottom }]}
            accessibilityLabel="Set a reminder"
          >
            <View style={styles.handle} />
            <View style={styles.title}>
              <Text style={styles.heading} accessibilityRole="header">
                Set a reminder
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                testID="reminder-form-cancel"
                onPress={() => {
                  if (!closing()) dismiss();
                }}
                style={styles.cancel}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
            </View>
            <ScrollView
              ref={scroll}
              style={styles.scroll}
              // Room under the last line, once the fields scroll, for the
              // fade over their foot to leave it readable.
              contentContainerStyle={[styles.fields, overflows && styles.fieldsOver]}
              keyboardShouldPersistTaps="handled"
              persistentScrollbar
              onLayout={(event) => {
                hold(event.nativeEvent.layout.y);
                setShownHeight(event.nativeEvent.layout.height);
              }}
              onContentSizeChange={(_width, height) => {
                setContentHeight(height);
                if (!revealPicker.current) return;
                revealPicker.current = false;
                scroll.current?.scrollToEnd({ animated: true });
              }}
            >
              <Text style={styles.where}>
                {where
                  ? `Posts in ${where} for everyone when the time comes.`
                  : "Posts in this conversation when the time comes."}
              </Text>
              <View style={styles.field}>
                <Text style={styles.label}>Reminder</Text>
                <TextInput
                  ref={input}
                  value={form.text}
                  onChangeText={(text) => change((current) => withText(current, text))}
                  editable={!setting}
                  placeholder="What should everyone remember?"
                  placeholderTextColor={theme.textMuted}
                  accessibilityLabel="Reminder"
                  accessibilityHint={textProblem ?? undefined}
                  testID="reminder-text"
                  maxLength={REMINDER_TEXT_MAX * 2}
                  returnKeyType="done"
                  submitBehavior="blurAndSubmit"
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  style={[styles.input, focused && styles.inputFocused, !!textProblem && styles.inputBad]}
                />
                {textProblem && (
                  <Text style={styles.error} accessibilityRole="alert">
                    {textProblem}
                  </Text>
                )}
              </View>
              <ReminderWhen
                form={form}
                now={now}
                problem={whenProblem}
                caution={whenCaution}
                locked={setting}
                onChoice={(choice) => change((current) => withChoice(current, choice))}
                onCustom={(value) => change((current) => withCustom(current, value))}
                onPickerShown={showPicker}
              />
            </ScrollView>
            {/* Set on a strip of the sheet's own, the fields fading out
                into it while they scroll under it (PollForm). */}
            <View style={styles.foot}>
              {overflows && (
                <View style={styles.fade} pointerEvents="none">
                  <EdgeFade edge="bottom" height={FADE} color={theme.panel} />
                </View>
              )}
              {failure && failure.field === null && (
                <Text style={[styles.error, styles.failure]} accessibilityRole="alert">
                  {failure.text}
                </Text>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={setting ? "Setting" : "Set reminder"}
                accessibilityState={{ disabled: !settable, busy: setting }}
                disabled={!settable}
                testID="reminder-set"
                onPress={set}
                style={({ pressed }) => [styles.set, !settable && styles.off, pressed && styles.setPressed]}
              >
                <Text style={styles.setText}>{setting ? "Setting…" : "Set reminder"}</Text>
              </Pressable>
            </View>
          </SheetFrame>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    fill: {
      flex: 1,
    },
    scrim: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: theme.scrim,
    },
    sheet: {
      paddingTop: 8,
      paddingHorizontal: 8,
      borderTopLeftRadius: tokens.radiusLg,
      borderTopRightRadius: tokens.radiusLg,
      backgroundColor: theme.panel,
    },
    handle: {
      alignSelf: "center",
      width: 36,
      height: 5,
      marginBottom: 12,
      borderRadius: tokens.radiusPill,
      backgroundColor: theme.border,
    },
    title: {
      flexDirection: "row",
      alignItems: "center",
      marginLeft: 12,
      marginRight: 4,
      marginBottom: 4,
    },
    heading: {
      flex: 1,
      color: theme.text,
      fontSize: 17,
      fontWeight: "700",
    },
    cancel: {
      minHeight: 44,
      paddingHorizontal: 8,
      justifyContent: "center",
    },
    cancelText: {
      color: theme.accent,
      fontSize: 16,
    },
    scroll: {
      flexGrow: 0,
    },
    fields: {
      gap: 12,
      paddingHorizontal: 8,
      paddingBottom: 4,
    },
    where: {
      color: theme.textMuted,
      fontSize: tokens.textSm,
    },
    fieldsOver: {
      paddingBottom: FADE,
    },
    field: {
      gap: 6,
    },
    label: {
      color: theme.textMuted,
      fontSize: tokens.textUi,
    },
    input: {
      minHeight: 48,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: tokens.radiusLg,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      color: theme.text,
      fontSize: 16,
    },
    inputFocused: {
      borderColor: theme.accent,
    },
    inputBad: {
      borderColor: theme.danger,
    },
    error: {
      color: theme.danger,
      fontSize: tokens.textSm,
    },
    foot: {
      paddingTop: 12,
      backgroundColor: theme.panel,
    },
    // Over the fields' foot, just above the strip.
    fade: {
      position: "absolute",
      left: 0,
      right: 0,
      top: -FADE,
      height: FADE,
    },
    failure: {
      marginHorizontal: 8,
      marginBottom: 8,
      fontSize: tokens.textUi,
    },
    set: {
      minHeight: 48,
      marginHorizontal: 8,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: tokens.radiusLg,
      backgroundColor: theme.accent,
    },
    setPressed: {
      opacity: 0.85,
    },
    off: {
      opacity: tokens.disabled,
    },
    setText: {
      color: theme.onAccent,
      fontSize: 16,
      fontWeight: "600",
    },
  });
}
