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
import { useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
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

// Creating a poll, from Poll in the attach sheet (docs/architecture/
// messaging.md → Polls): a sheet over a scrim, as the attach sheet is
// (useSheet), with "Create a poll" and Cancel, the question, one option
// or several directly under it, then the options (PollFormOptions), and
// Post poll. The rules are web's, shared (core/pollForm): a field the
// server would refuse says why under it, and Post is on once there is a
// question and two options and nothing is wrong. Post is off while the
// request is out; the screen sends it (onPost), and the sheet goes once
// the server has the poll. A refusal is said over Post, everything typed
// kept. The sheet sits on the keyboard while a field has it, Post with
// it, and what does not fit scrolls; a swipe down on the fields scrolls
// them, so only the sheet's top drags it away. Cancel, a tap on the
// scrim, a swipe down from the top or Android's back closes it with
// nothing sent.
export default function PollForm({
  channelId,
  onPost,
  onClose,
}: {
  channelId: string;
  onPost: (request: PollRequest) => Promise<void>;
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
  const firstOption = useRef<TextInputInstance>(null);
  const check = checkPollForm(form);

  const change = (update: (now: typeof form) => typeof form) => {
    setFailure(null);
    setForm(update);
  };

  const post = async () => {
    if (posting || !check.canPost || closing()) return;
    setPosting(true);
    setFailure(null);
    try {
      await onPost(pollRequest(form, channelId));
      dismiss();
    } catch (err) {
      setFailure(`Couldn't post the poll. ${errorText(err)}`);
    } finally {
      setPosting(false);
    }
  };

  const bottom = keyboard > 0 ? 8 : Math.max(insets.bottom, 8) + 8;
  const most = window.height - keyboard - insets.top - ABOVE;
  const postable = check.canPost && !posting;
  const questionProblem = check.question;

  return (
    <Modal transparent visible animationType="none" onRequestClose={dismiss} statusBarTranslucent navigationBarTranslucent>
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
              style={styles.scroll}
              contentContainerStyle={styles.fields}
              keyboardShouldPersistTaps="handled"
              // Swipes on the fields are the fields', from where they start.
              onLayout={(event) => hold(event.nativeEvent.layout.y)}
            >
              <View style={styles.field}>
                <Text style={styles.label}>Question</Text>
                <TextInput
                  value={form.question}
                  onChangeText={(text) => change((now) => withQuestion(now, text))}
                  placeholder="Ask a question"
                  placeholderTextColor={theme.textMuted}
                  accessibilityLabel="Question"
                  accessibilityHint={questionProblem ? pollProblemText(questionProblem, "question") : undefined}
                  testID="poll-question"
                  autoFocus
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
                    styles={styles}
                    theme={theme}
                  />
                  <Half
                    label="Several options"
                    on={form.multiple}
                    onPress={() => change((now) => withMultiple(now, true))}
                    styles={styles}
                    theme={theme}
                  />
                </View>
              </View>
              <PollFormOptions
                form={form}
                problems={check.options}
                focusKey={typeof focus === "number" ? focus : null}
                first={firstOption}
                onChange={change}
                onFocusKey={setFocus}
              />
            </ScrollView>
            {failure && (
              <Text style={[styles.error, styles.failure]} accessibilityRole="alert">
                {failure}
              </Text>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Post poll"
              accessibilityState={{ disabled: !postable, busy: posting }}
              disabled={!postable}
              testID="poll-post"
              onPress={post}
              style={({ pressed }) => [styles.post, !postable && styles.off, pressed && styles.postPressed]}
            >
              <Text style={styles.postText}>Post poll</Text>
            </Pressable>
          </SheetFrame>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

type Styles = ReturnType<typeof makeStyles>;

// One half of "People can choose", the chosen one raised and ticked.
function Half({
  label,
  on,
  onPress,
  styles,
  theme,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  styles: Styles;
  theme: Theme;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: on }}
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
      paddingBottom: 12,
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
