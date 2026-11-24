import {
  addOption,
  canAddOption,
  canRemoveOption,
  POLL_OPTION_MAX,
  POLL_OPTIONS_FULL,
  type PollFieldProblem,
  type PollForm,
  pollOptionCount,
  pollProblemText,
  removeOption,
  withOptionText,
} from "@stoop/core/pollForm";
import { type RefObject, useEffect, useRef } from "react";
import { Pressable, StyleSheet, Text, TextInput, type TextInputInstance, View } from "react-native";
import { CloseIcon, PlusIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";

// The options of the poll's form (PollForm): "Options" with how many of
// ten, a field for each with its remove button (off at two), and Add
// option under them (off at ten, saying why). A field's problem
// (core/pollForm checkPollForm) is said under it. Next on the keyboard
// goes from each field to the one below; Add option puts the caret in
// the new field.
export default function PollFormOptions({
  form,
  problems,
  focusKey,
  first,
  locked,
  onChange,
  onFocusKey,
}: {
  form: PollForm;
  problems: Record<number, PollFieldProblem>;
  // The field that has the caret, for its edge.
  focusKey: number | null;
  // The first field, for the question's Next.
  first: RefObject<TextInputInstance | null>;
  // While the request is out: nothing changes.
  locked: boolean;
  onChange: (update: (form: PollForm) => PollForm) => void;
  onFocusKey: (key: number | null) => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const fields = useRef(new Map<number, TextInputInstance>());
  // The field Add option made, to take the caret once it is drawn.
  const added = useRef<number | null>(null);
  useEffect(() => {
    if (added.current === null) return;
    fields.current.get(added.current)?.focus();
    added.current = null;
  });
  const removable = canRemoveOption(form) && !locked;
  const addable = canAddOption(form) && !locked;

  return (
    <View style={styles.group}>
      <View style={styles.head}>
        <Text style={styles.label}>Options</Text>
        <Text style={styles.count}>{pollOptionCount(form)}</Text>
      </View>
      {form.options.map((option, index) => {
        const problem = problems[option.key];
        const next = form.options[index + 1];
        return (
          <View key={option.key} style={styles.option}>
            <View style={styles.line}>
              <TextInput
                ref={(input) => {
                  if (input) fields.current.set(option.key, input);
                  else fields.current.delete(option.key);
                  if (index === 0) first.current = input;
                }}
                value={option.text}
                onChangeText={(text) => onChange((now) => withOptionText(now, option.key, text))}
                editable={!locked}
                placeholder={`Option ${index + 1}`}
                placeholderTextColor={theme.textMuted}
                accessibilityLabel={`Option ${index + 1}`}
                accessibilityHint={problem ? pollProblemText(problem, "option") : undefined}
                testID={`poll-option-${index + 1}`}
                maxLength={POLL_OPTION_MAX * 2}
                returnKeyType={next ? "next" : "done"}
                submitBehavior={next ? "submit" : "blurAndSubmit"}
                onSubmitEditing={() => next && fields.current.get(next.key)?.focus()}
                onFocus={() => onFocusKey(option.key)}
                onBlur={() => onFocusKey(null)}
                style={[
                  styles.input,
                  focusKey === option.key && styles.inputFocused,
                  problem && styles.inputBad,
                ]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove option ${index + 1}`}
                accessibilityState={{ disabled: !removable }}
                disabled={!removable}
                onPress={() => onChange((now) => removeOption(now, option.key))}
                style={({ pressed }) => [styles.remove, !removable && styles.off, pressed && styles.pressed]}
              >
                <CloseIcon color={theme.textMuted} size={18} />
              </Pressable>
            </View>
            {problem && (
              <Text style={styles.error} accessibilityRole="alert">
                {pollProblemText(problem, "option")}
              </Text>
            )}
          </View>
        );
      })}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add option"
        accessibilityState={{ disabled: !addable }}
        accessibilityHint={canAddOption(form) ? undefined : POLL_OPTIONS_FULL}
        disabled={!addable}
        testID="poll-add-option"
        onPress={() => {
          added.current = form.nextKey;
          onChange(addOption);
        }}
        style={({ pressed }) => [styles.add, !addable && styles.off, pressed && styles.pressed]}
      >
        <PlusIcon color={theme.text} size={18} />
        <Text style={styles.addText}>Add option</Text>
      </Pressable>
      {!canAddOption(form) && <Text style={styles.note}>{POLL_OPTIONS_FULL}</Text>}
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
    option: {
      gap: 4,
    },
    line: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    input: {
      flex: 1,
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
    error: {
      color: theme.danger,
      fontSize: tokens.textSm,
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
  });
}
