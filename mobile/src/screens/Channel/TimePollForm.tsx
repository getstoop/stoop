import { POLL_QUESTION_MAX, pollProblemText, withMultiple, withQuestion } from "@stoop/core/pollForm";
import {
  checkTimePollForm,
  newTimePollForm,
  type TimePollRequest,
  timePollRequest,
} from "@stoop/core/timePollForm";
import { useEffect, useRef, useState } from "react";
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
import SheetFrame from "../../components/SheetFrame";
import { useKeyboardHeight } from "../../hooks/useKeyboardHeight";
import { useSheet } from "../../hooks/useSheet";
import { type Theme, tokens, useTheme } from "../../theme";
import EdgeFade from "./EdgeFade";
import PollChoice from "./PollChoice";
import { pollRefusal } from "./pollRefusal";
import TimePollSlots from "./TimePollSlots";

// What the sheet leaves above itself, over the keyboard, of the channel.
const ABOVE = 48;
// How long after the modal shows the question takes the caret (PollForm).
const FOCUS_DELAY_MS = 300;
// How often the times are judged again while the sheet is up, so a time
// that goes by meanwhile is said before Post is pressed (web's).
const TICK_MS = 15_000;
// Room kept around a stretch scrolled into view; under it the fade over
// the fields' foot too.
const REVEAL_MARGIN = 8;
// How tall the fade the fields scroll under is, above Post poll.
const FADE = 24;

// Find a time, from its row in the attach sheet or /when in the composer
// (docs/architecture/messaging.md → Polls, Slash commands): a poll whose
// options are times, in a sheet drawn as the poll's form is (PollForm):
// "Find a time" and Cancel, the question, one time or several directly
// under it (several to start), then the times (TimePollSlots), each a
// date and a time on the system's pickers, and Post poll. The state and
// the rules are web's, shared (core/timePollForm): a row this device's
// clock reads as gone by, over a year away or the same as an earlier one
// says so under it, judged again every 15 seconds and once more as Post
// is pressed, and Post is on for a question and two times with nothing
// wrong. The times go as instants by this device's zone rules; the
// server judges them by its own clock, and its refusal is said over Post,
// everything kept. Posting, Cancel while it is out, and a refusal after
// the sheet has gone are as on the poll's form. The question takes the
// caret as the sheet shows, unless /when filled it; no picker opens by
// itself.
export default function TimePollForm({
  channelId,
  question: startQuestion = "",
  onPost,
  onPosted,
  onLateFailure,
  onClose,
}: {
  channelId: string;
  // The question it opens with: the words typed after /when.
  question?: string;
  onPost: (request: TimePollRequest) => Promise<void>;
  // The poll was saved while the sheet was still up.
  onPosted: () => void;
  // The request was refused after the sheet had gone.
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
  const [form, setForm] = useState(() => newTimePollForm(startQuestion));
  const [startsFilled] = useState(form.question !== "");
  const [now, setNow] = useState(() => new Date());
  const [posting, setPosting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const question = useRef<TextInputInstance>(null);
  // The fields' scroll: where it is, how much shows, how much there is,
  // and where the times start in it, to keep an open picker in view.
  const scroll = useRef<ScrollViewInstance>(null);
  const scrolled = useRef(0);
  const [shownHeight, setShownHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const slotsAt = useRef(0);
  const overflows = contentHeight > shownHeight + 1;
  const reveal = (top: number, bottom: number) => {
    const from = slotsAt.current + top - REVEAL_MARGIN;
    const to = slotsAt.current + bottom + REVEAL_MARGIN + FADE;
    // Taller than what shows: its top, where the fields are.
    if (to - from > shownHeight) scroll.current?.scrollTo({ y: Math.max(0, from), animated: true });
    else if (to > scrolled.current + shownHeight) scroll.current?.scrollTo({ y: to - shownHeight, animated: true });
    else if (from < scrolled.current) scroll.current?.scrollTo({ y: Math.max(0, from), animated: true });
  };
  // Whether the sheet is still there to say what became of the request,
  // and the guard against a second, set at once.
  const mounted = useRef(true);
  const postingNow = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const tick = setInterval(() => setNow(new Date()), TICK_MS);
    return () => {
      mounted.current = false;
      clearInterval(tick);
    };
  }, []);
  const check = checkTimePollForm(form, now);

  const change = (update: (current: typeof form) => typeof form) => {
    if (posting) return;
    setFailure(null);
    setForm(update);
    setNow(new Date());
  };

  const post = async () => {
    if (postingNow.current || closing()) return;
    // Judged again at this moment: a time may have gone by.
    const sentAt = new Date();
    setNow(sentAt);
    if (!checkTimePollForm(form, sentAt).canPost) return;
    postingNow.current = true;
    setPosting(true);
    setFailure(null);
    try {
      await onPost(timePollRequest(form, channelId));
      if (!mounted.current || closing()) return;
      onPosted();
      dismiss();
    } catch (err) {
      postingNow.current = false;
      if (!mounted.current || closing()) onLateFailure(err);
      else setFailure(pollRefusal(err));
    } finally {
      if (mounted.current) setPosting(false);
    }
  };

  const bottom = keyboard > 0 ? 8 : Math.max(insets.bottom, 8) + 8;
  const most = window.height - keyboard - insets.top - ABOVE;
  const postable = check.canPost && !posting;
  const questionProblem = check.question;

  return (
    <Modal
      transparent
      visible
      animationType="none"
      onRequestClose={dismiss}
      // The question takes the caret a moment after the modal shows
      // (PollForm says why); not when /when filled it.
      onShow={() => {
        if (!startsFilled) setTimeout(() => question.current?.focus(), FOCUS_DELAY_MS);
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
          testID="time-poll-form-close"
        />
        <View style={{ marginBottom: keyboard }}>
          <SheetFrame
            sheet={sheet}
            style={[styles.sheet, { maxHeight: most, paddingBottom: bottom }]}
            accessibilityLabel="Find a time"
          >
            <View style={styles.handle} />
            <View style={styles.title}>
              <Text style={styles.heading} accessibilityRole="header">
                Find a time
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                testID="time-poll-form-cancel"
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
              contentContainerStyle={styles.fields}
              keyboardShouldPersistTaps="handled"
              persistentScrollbar
              // Swipes on the fields are the fields', from where they start.
              onLayout={(event) => {
                hold(event.nativeEvent.layout.y);
                setShownHeight(event.nativeEvent.layout.height);
              }}
              onContentSizeChange={(_width, height) => setContentHeight(height)}
              onScroll={(event) => {
                scrolled.current = event.nativeEvent.contentOffset.y;
              }}
              scrollEventThrottle={16}
            >
              <View style={styles.field}>
                <Text style={styles.label}>Question</Text>
                <TextInput
                  ref={question}
                  value={form.question}
                  onChangeText={(text) => change((current) => withQuestion(current, text))}
                  editable={!posting}
                  placeholder="Ask a question"
                  placeholderTextColor={theme.textMuted}
                  accessibilityLabel="Question"
                  accessibilityHint={questionProblem ? pollProblemText(questionProblem, "question") : undefined}
                  testID="time-poll-question"
                  maxLength={POLL_QUESTION_MAX * 2}
                  returnKeyType="done"
                  submitBehavior="blurAndSubmit"
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  style={[styles.input, focused && styles.inputFocused, questionProblem && styles.inputBad]}
                />
                {questionProblem && (
                  <Text style={styles.error} accessibilityRole="alert">
                    {pollProblemText(questionProblem, "question")}
                  </Text>
                )}
              </View>
              <PollChoice
                noun="time"
                multiple={form.multiple}
                disabled={posting}
                onChange={(multiple) => change((current) => withMultiple(current, multiple))}
              />
              <View
                onLayout={(event) => {
                  slotsAt.current = event.nativeEvent.layout.y;
                }}
              >
                <TimePollSlots
                  form={form}
                  now={now}
                  problems={check.slots}
                  locked={posting}
                  onChange={change}
                  onReveal={reveal}
                />
              </View>
            </ScrollView>
            {/* Post on a strip of the sheet's own, the fields fading out
                into it while they scroll under it (PollForm). */}
            <View style={styles.foot}>
              {overflows && (
                <View style={styles.fade} pointerEvents="none">
                  <EdgeFade edge="bottom" height={FADE} color={theme.panel} />
                </View>
              )}
              {failure && (
                <Text style={[styles.error, styles.failure]} accessibilityRole="alert">
                  {failure}
                </Text>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={posting ? "Posting" : "Post poll"}
                accessibilityState={{ disabled: !postable, busy: posting }}
                disabled={!postable}
                testID="time-poll-post"
                onPress={post}
                style={({ pressed }) => [styles.post, !postable && styles.off, pressed && styles.postPressed]}
              >
                <Text style={styles.postText}>{posting ? "Posting…" : "Post poll"}</Text>
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
      marginBottom: 8,
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
    post: {
      minHeight: 48,
      marginHorizontal: 8,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: tokens.radiusLg,
      backgroundColor: theme.accent,
    },
    postPressed: {
      opacity: 0.85,
    },
    off: {
      opacity: tokens.disabled,
    },
    postText: {
      color: theme.onAccent,
      fontSize: 16,
      fontWeight: "600",
    },
  });
}
