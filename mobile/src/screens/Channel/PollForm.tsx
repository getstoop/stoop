import {
  checkPollForm,
  newPollForm,
  POLL_QUESTION_MAX,
  type PollRequest,
  pollProblemText,
  pollRequest,
  withMultiple,
  withQuestion,
} from "@stoop/core/pollForm";
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
import { errorText } from "../../api/errors";
import { CheckIcon } from "../../components/Icons";
import SheetFrame from "../../components/SheetFrame";
import { useKeyboardHeight } from "../../hooks/useKeyboardHeight";
import { useSheet } from "../../hooks/useSheet";
import { type Theme, tokens, useTheme } from "../../theme";
import PollFormOptions from "./PollFormOptions";

// What the sheet leaves above itself, over the keyboard, of the channel.
const ABOVE = 48;
// How long after the modal shows the question takes the caret (above).
const FOCUS_DELAY_MS = 300;
// Room kept around a field scrolled into view.
const REVEAL_MARGIN = 8;

// Creating a poll, from Poll in the attach sheet (docs/architecture/
// messaging.md → Polls): a sheet over a scrim, as the attach sheet is
// (useSheet), with "Create a poll" and Cancel, the question, one option
// or several directly under it, then the options (PollFormOptions), and
// Post poll. The rules are web's, shared (core/pollForm): a field the
// server would refuse says why under it, and Post is on once there is a
// question and two options and nothing is wrong. While the request is
// out Post reads "Posting…" and the fields are locked; the screen sends
// it (onPost), and once the server has the poll the sheet goes and the
// screen follows it (onPosted). A refusal is said over Post, everything
// typed kept. Cancel still works while the request is out: the poll is
// then the server's to keep or refuse, and a refusal arriving after the
// sheet has gone is the screen's to say (onLateFailure); a poll saved
// then simply appears. The sheet sits on the keyboard while a field has it, Post with
// it, and what does not fit scrolls; a swipe down on the fields scrolls
// them, so only the sheet's top drags it away. Cancel, a tap on the
// scrim, a swipe down from the top or Android's back closes it with
// nothing sent.
export default function PollForm({
  channelId,
  onPost,
  onPosted,
  onLateFailure,
  onClose,
}: {
  channelId: string;
  onPost: (request: PollRequest) => Promise<void>;
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
  const [form, setForm] = useState(newPollForm);
  const [posting, setPosting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [focus, setFocus] = useState<"question" | number | null>(null);
  const question = useRef<TextInputInstance>(null);
  // The fields' scroll: where it is, how much shows, how much there is,
  // and where the options start in it, to keep a field in view.
  const scroll = useRef<ScrollViewInstance>(null);
  const scrolled = useRef(0);
  const [shownHeight, setShownHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const optionsAt = useRef(0);
  const overflows = contentHeight > shownHeight + 1;
  const reveal = (top: number, bottom: number) => {
    const from = optionsAt.current + top - REVEAL_MARGIN;
    const to = optionsAt.current + bottom + REVEAL_MARGIN;
    if (to > scrolled.current + shownHeight) scroll.current?.scrollTo({ y: to - shownHeight, animated: true });
    else if (from < scrolled.current) scroll.current?.scrollTo({ y: Math.max(0, from), animated: true });
  };
  const firstOption = useRef<TextInputInstance>(null);
  // Whether the sheet is still there to say what became of the request.
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const check = checkPollForm(form);

  const change = (update: (now: typeof form) => typeof form) => {
    if (posting) return;
    setFailure(null);
    setForm(update);
  };

  const post = async () => {
    if (posting || !check.canPost || closing()) return;
    setPosting(true);
    setFailure(null);
    try {
      await onPost(pollRequest(form, channelId));
      if (!mounted.current || closing()) return;
      onPosted();
      dismiss();
    } catch (err) {
      if (!mounted.current || closing()) onLateFailure(err);
      else setFailure(refusal(err));
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
      // The question takes the caret once the modal is up, a moment
      // after: autoFocus, or a focus as it shows, focuses it on Android
      // before the modal's window has the input method, and the keyboard
      // never comes.
      onShow={() => {
        setTimeout(() => question.current?.focus(), FOCUS_DELAY_MS);
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
          testID="poll-form-close"
        />
        <View style={{ marginBottom: keyboard }}>
          <SheetFrame sheet={sheet} style={[styles.sheet, { maxHeight: most, paddingBottom: bottom }]} accessibilityLabel="Create a poll">
            <View style={styles.handle} />
            <View style={styles.title}>
              <Text style={styles.heading} accessibilityRole="header">
                Create a poll
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                testID="poll-form-cancel"
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
                  onChangeText={(text) => change((now) => withQuestion(now, text))}
                  editable={!posting}
                  placeholder="Ask a question"
                  placeholderTextColor={theme.textMuted}
                  accessibilityLabel="Question"
                  accessibilityHint={questionProblem ? pollProblemText(questionProblem, "question") : undefined}
                  testID="poll-question"
                  maxLength={POLL_QUESTION_MAX * 2}
                  returnKeyType="next"
                  submitBehavior="submit"
                  onSubmitEditing={() => firstOption.current?.focus()}
                  onFocus={() => setFocus("question")}
                  onBlur={() => setFocus(null)}
                  style={[styles.input, focus === "question" && styles.inputFocused, questionProblem && styles.inputBad]}
                />
                {questionProblem && (
                  <Text style={styles.error} accessibilityRole="alert">
                    {pollProblemText(questionProblem, "question")}
                  </Text>
                )}
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>People can choose</Text>
                <View style={styles.choice} accessibilityRole="radiogroup" accessibilityLabel="People can choose">
                  <Half
                    label="One option"
                    on={!form.multiple}
                    onPress={() => change((now) => withMultiple(now, false))}
                    disabled={posting}
                    styles={styles}
                    theme={theme}
                  />
                  <Half
                    label="Several options"
                    on={form.multiple}
                    onPress={() => change((now) => withMultiple(now, true))}
                    disabled={posting}
                    styles={styles}
                    theme={theme}
                  />
                </View>
              </View>
              <View
                onLayout={(event) => {
                  optionsAt.current = event.nativeEvent.layout.y;
                }}
              >
                <PollFormOptions
                  form={form}
                  problems={check.options}
                  focusKey={typeof focus === "number" ? focus : null}
                  first={firstOption}
                  locked={posting}
                  onChange={change}
                  onFocusKey={setFocus}
                  onReveal={reveal}
                />
              </View>
            </ScrollView>
            {/* Post on a strip of the sheet's own, the list ending above
                it, with a rule while the fields scroll under it. */}
            <View style={[styles.foot, overflows && styles.footRuled]}>
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
                testID="poll-post"
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

// What a refusal says, as web's form words it: "Couldn't post the poll."
// and the server's words as a sentence, or "Try again." when it gave none.
function refusal(err: unknown): string {
  const said = errorText(err).trim();
  if (!said) return "Couldn't post the poll. Try again.";
  const sentence = said[0].toUpperCase() + said.slice(1);
  return `Couldn't post the poll. ${sentence}${/[.!?]$/.test(sentence) ? "" : "."}`;
}

type Styles = ReturnType<typeof makeStyles>;

// One half of "People can choose", the chosen one raised and ticked.
function Half({
  label,
  on,
  onPress,
  disabled,
  styles,
  theme,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  disabled: boolean;
  styles: Styles;
  theme: Theme;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: on, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.half, on && styles.halfOn]}
    >
      {on && <CheckIcon color={theme.text} size={14} />}
      <Text style={[styles.halfText, on && styles.halfTextOn]}>{label}</Text>
    </Pressable>
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
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: "transparent",
      backgroundColor: theme.panel,
    },
    footRuled: {
      borderTopColor: theme.border,
    },
    failure: {
      marginHorizontal: 8,
      marginBottom: 8,
      fontSize: tokens.textUi,
    },
    choice: {
      flexDirection: "row",
      padding: 2,
      borderRadius: tokens.radiusMd,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
    },
    half: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      minHeight: 44,
      paddingHorizontal: 12,
      borderRadius: tokens.radius,
    },
    halfOn: {
      backgroundColor: theme.raised,
    },
    halfText: {
      color: theme.textMuted,
      fontSize: tokens.textBody,
      fontWeight: "600",
    },
    halfTextOn: {
      color: theme.text,
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
