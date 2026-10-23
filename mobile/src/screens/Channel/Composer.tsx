import { isBlankMessage } from "@stoop/core/markdown";
import { restoreDraft } from "@stoop/core/unsent";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { type ComponentRef, type ReactNode, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from "react-native";
import { errorText } from "../../api/errors";
import { PlusIcon, SendIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";
import FormatRow from "./FormatRow";

// Where a message is written: one control in two states. At rest it is a
// pill floating over the list, Attach and "Message #channel"; tapped, it
// becomes a card above the keyboard, the text on top and under it
// Attach, Aa (which opens the formatting row) and Send. Losing focus
// returns it to the pill, the draft kept. Only Send does anything yet:
// Attach and the formats are placed for the steps that give them work.
//
// Sending is send-then-merge, never a pending row: the draft is cleared
// as Send is pressed and the row appears when the server answers (or
// its event lands first; core/channelScreen `sent`). A refusal puts the
// draft back ahead of anything typed since, with the server's words
// under it; pressing Send again is the retry.

// The pill's height and the gap under it, for the screen to keep the
// list's newest message clear of it.
export const PILL = 48;
export const GAP = 8;

const MAX_LINES = 6;

export default function Composer({
  channelName,
  send,
}: {
  channelName: string;
  send: (content: string) => Promise<void>;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [draft, setDraft] = useState("");
  const [writing, setWriting] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  // Send pressed again before React commits the sending state must not
  // send twice, so the guard is a ref as well.
  const sendingRef = useRef(false);
  const glass = Platform.OS === "ios" && isLiquidGlassAvailable();

  // Android hides the keyboard (the back gesture) without blurring the
  // field; iOS blurs it, so the field's own onBlur covers it there.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = Keyboard.addListener("keyboardDidHide", () => input.current?.blur());
    return () => sub.remove();
  }, []);

  const placeholder = `Message #${channelName}`;
  const blank = isBlankMessage(draft);

  const submit = async () => {
    if (sendingRef.current || blank) return;
    sendingRef.current = true;
    const typed = draft;
    setDraft("");
    setError(null);
    setSending(true);
    try {
      await send(typed.trim());
    } catch (err) {
      setDraft((typedSince) => restoreDraft(typed, typedSince));
      setError(errorText(err));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const raised = glass ? styles.glassRaised : styles.raised;

  if (!writing) {
    return (
      <Surface glass={glass} style={styles.pill}>
        <Round label="Attach files" style={raised}>
          <PlusIcon color={theme.text} size={22} />
        </Round>
        <Pressable accessibilityRole="button" onPress={() => setWriting(true)} style={styles.prompt}>
          <Text numberOfLines={1} style={draft ? styles.draft : styles.placeholder}>
            {draft || placeholder}
          </Text>
        </Pressable>
        {/* A send that failed after the field lost focus: the reason waits in
            the card, so the pill says there is one. */}
        {error && <Text style={styles.failed}>Couldn't send</Text>}
      </Surface>
    );
  }

  return (
    <Surface glass={glass} style={styles.card}>
      <TextInput
        ref={input}
        testID="composer"
        autoFocus
        multiline
        value={draft}
        onChangeText={setDraft}
        onBlur={() => setWriting(false)}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        accessibilityLabel={placeholder}
        style={styles.field}
      />
      {error && (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      )}
      {formatting && <FormatRow />}
      <View style={styles.buttons}>
        <Round label="Attach files" style={raised}>
          <PlusIcon color={theme.text} size={22} />
        </Round>
        <Round
          label="Formatting"
          pressed={formatting}
          onPress={() => setFormatting((open) => !open)}
          style={formatting && styles.toggled}
        >
          <Text style={styles.aa}>Aa</Text>
        </Round>
        <View style={styles.spacer} />
        <Round label="Send" disabled={blank || sending} onPress={submit} style={styles.send}>
          {sending ? <ActivityIndicator color={theme.onAccent} /> : <SendIcon color={theme.onAccent} />}
        </Round>
      </View>
    </Surface>
  );
}

// The composer's surface: Liquid Glass where iOS has it, else drawn with
// the theme's panel and border under a light shadow, as the composing
// mockup for Android draws it.
function Surface({ glass, children, style }: { glass: boolean; children: ReactNode; style: ViewStyle }) {
  const theme = useTheme();
  if (glass) {
    return (
      <GlassView glassEffectStyle="regular" colorScheme={theme.scheme} style={[style, { overflow: "hidden" }]}>
        {children}
      </GlassView>
    );
  }
  return (
    <View
      style={[
        style,
        {
          backgroundColor: theme.panel,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.border,
          boxShadow: theme.scheme === "dark" ? "0 6px 20px rgba(0, 0, 0, 0.35)" : "0 6px 20px rgba(30, 25, 20, 0.16)",
        },
      ]}
    >
      {children}
    </View>
  );
}

// A 40px round button.
function Round({
  label,
  children,
  onPress,
  disabled,
  pressed,
  style,
}: {
  label: string;
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  pressed?: boolean;
  style?: ViewStyle | false;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: pressed }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed: down }) => [
        roundStyles.round,
        style,
        disabled && roundStyles.disabled,
        down && roundStyles.down,
      ]}
    >
      {children}
    </Pressable>
  );
}

const roundStyles = StyleSheet.create({
  round: {
    width: 40,
    height: 40,
    borderRadius: tokens.radiusPill,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: {
    opacity: 0.5,
  },
  down: {
    opacity: 0.85,
  },
});

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    pill: {
      height: PILL,
      marginHorizontal: 12,
      borderRadius: tokens.radiusPill,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingLeft: 4,
      paddingRight: 8,
    },
    prompt: {
      flex: 1,
      height: 40,
      justifyContent: "center",
      paddingLeft: 6,
    },
    placeholder: {
      color: theme.textMuted,
      fontSize: 17,
    },
    draft: {
      color: theme.text,
      fontSize: 17,
    },
    card: {
      marginHorizontal: 8,
      borderRadius: 24,
      paddingTop: 6,
      paddingBottom: 8,
      paddingHorizontal: 8,
      gap: 4,
    },
    field: {
      minHeight: 44,
      maxHeight: 11 + 8 + 23 * MAX_LINES,
      paddingTop: 11,
      paddingBottom: 8,
      paddingHorizontal: 10,
      color: theme.text,
      fontSize: 17,
      lineHeight: 23,
    },
    error: {
      marginHorizontal: 10,
      color: theme.danger,
      fontSize: tokens.textUi,
      lineHeight: tokens.textUi * tokens.leadingUi,
    },
    buttons: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    spacer: {
      flex: 1,
    },
    raised: {
      backgroundColor: theme.raised,
    },
    // On glass a solid disc reads as a hole: the mockup's translucent one.
    glassRaised: {
      backgroundColor: theme.scheme === "dark" ? "rgba(255, 255, 255, 0.10)" : "rgba(0, 0, 0, 0.06)",
    },
    failed: {
      marginRight: 4,
      color: theme.danger,
      fontSize: tokens.textSm,
    },
    toggled: {
      backgroundColor: theme.accentSoft,
    },
    aa: {
      color: theme.text,
      fontSize: 17,
      fontWeight: "600",
    },
    send: {
      backgroundColor: theme.accent,
    },
  });
}
