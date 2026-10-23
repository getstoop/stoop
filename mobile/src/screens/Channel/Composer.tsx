import { editableText, withTokensRestored } from "@stoop/core/editableText";
import { isBlankMessage } from "@stoop/core/markdown";
import { messagePreview } from "@stoop/core/messagePreview";
import { restoreDraft } from "@stoop/core/unsent";
import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { type ComponentRef, forwardRef, type ReactNode, useEffect, useImperativeHandle, useRef, useState } from "react";
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
import { authorName } from "../../api/authors";
import { errorText } from "../../api/errors";
import { CheckIcon, CloseIcon, PencilIcon, PlusIcon, QuoteReplyIcon, SendIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";
import FormatRow from "./FormatRow";

// Where a message is written: one control in two states. At rest it is a
// pill floating over the list, Attach and "Message #channel"; tapped, it
// becomes a card above the keyboard, the text on top and under it
// Attach, Aa (which opens the formatting row) and Send. Losing focus
// returns it to the pill, the draft kept. Only Send does anything yet:
// Attach and the formats are placed for the steps that give them work.
//
// A message being quoted (`replyTo`, the screen's to hold) is the card's
// first line, the reply strip: "Replying to NAME · the first words", and
// Cancel reply, which drops it and keeps the draft. The pill says
// "Replying to NAME" with the strip's arrow, or the draft under that
// arrow, so the quote shows while the keyboard is down. `ref.open` puts
// the card up with the field focused, as a quote picked from the
// message menu does once the menu has gone.
//
// Sending is send-then-merge, never a pending row: the draft and the
// quote are cleared as Send is pressed and the row appears when the
// server answers (or its event lands first; core/channelScreen `sent`).
// A refusal puts the draft back ahead of anything typed since, with the
// server's words under it, and the quote back unless another was picked
// meanwhile (web's rule); pressing Send again is the retry.
//
// A message being edited (`editing`, the screen's to hold, never
// together with a quote) puts the composer in editing mode: the draft
// is set aside, the field holds the message's words (its mention and
// channel tokens as the @handle and #name they show as; core/editableText),
// the strip says "Editing message" with Cancel editing, Attach is dimmed
// since an edit changes words only, and Send is Save. Save puts the
// tokens back for the handles the original had and sends EditMessage;
// the answer merges like a send's. Words unchanged end the edit with no
// request; none at all are refused with web's wording, the edit going
// on; a refusal keeps the edited words with the server's under them.
// Editing ends on Save, Cancel editing, or the screen letting the
// message go (deleted, or quoted instead), and the set-aside draft comes
// back each way. A copy of the same message arriving edited elsewhere
// leaves the field's words alone; saving then replaces it, as on web.

// The pill's height and the gap under it, for the screen to keep the
// list's newest message clear of it.
export const PILL = 48;
export const GAP = 8;

const MAX_LINES = 6;

export type ComposerHandle = { open: () => void };

export default forwardRef<
  ComposerHandle,
  {
    channelName: string;
    send: (content: string, replyToMessageId: string) => Promise<void>;
    edit: (messageId: string, content: string) => Promise<void>;
    // The message being quoted, if any.
    replyTo: Message | null;
    onCancelReply: () => void;
    // A refused send's quote, coming back.
    onReply: (message: Message) => void;
    // The reader's own message being edited, if any.
    editing: Message | null;
    // Saved, or Cancel editing.
    onEditDone: () => void;
  }
>(function Composer({ channelName, send, edit, replyTo, onCancelReply, onReply, editing, onEditDone }, ref) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [draft, setDraft] = useState("");
  const [writing, setWriting] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  // The draft set aside while a message is edited, to come back after.
  const setAside = useRef("");
  // Which message the field holds for editing, so a change of it (in,
  // out, or to another message) is taken in the same render, while a
  // copy of the same one, edited elsewhere, leaves the field alone.
  const editingShown = useRef<string | null>(null);
  const editingId = editing?.id ?? null;
  if (editingShown.current !== editingId) {
    if (editingShown.current === null) setAside.current = draft;
    editingShown.current = editingId;
    setDraft(editing ? editableText(editing.content) : setAside.current);
    setError(null);
  }
  // Send pressed again before React commits the sending state must not
  // send twice, so the guard is a ref as well.
  const sendingRef = useRef(false);
  // The quote as it stands when a send's answer lands.
  const replyToRef = useRef(replyTo);
  replyToRef.current = replyTo;
  const glass = Platform.OS === "ios" && isLiquidGlassAvailable();

  // The card, with the field focused: mounted so (autoFocus), and focused
  // once more on the frame after it is up, since Android does not always
  // honour autoFocus on a field mounted as a modal goes; or focused again
  // if it is already up.
  const focusWanted = useRef(false);
  useImperativeHandle(
    ref,
    () => ({
      open: () => {
        if (writing) {
          input.current?.focus();
          return;
        }
        focusWanted.current = true;
        setWriting(true);
      },
    }),
    [writing],
  );
  useEffect(() => {
    if (!writing || !focusWanted.current) return;
    focusWanted.current = false;
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [writing]);

  // Android hides the keyboard (the back gesture) without blurring the
  // field; iOS blurs it, so the field's own onBlur covers it there.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = Keyboard.addListener("keyboardDidHide", () => input.current?.blur());
    return () => sub.remove();
  }, []);

  const placeholder = editing ? "Edit message" : `Message #${channelName}`;
  const blank = isBlankMessage(draft);
  const quotedName = replyTo ? authorName(replyTo.author) : "";

  // Save: the words as typed with the original's tokens put back. The
  // same words end the edit with nothing sent; no words are refused.
  const save = async (message: Message) => {
    const content = withTokensRestored(draft.trim(), message.content);
    if (content === message.content) {
      onEditDone();
      return;
    }
    if (blank) {
      setError("A message can't be empty — delete it instead.");
      return;
    }
    sendingRef.current = true;
    setError(null);
    setSending(true);
    try {
      await edit(message.id, content);
      if (editingShown.current === message.id) onEditDone();
    } catch (err) {
      // Unless the edit ended meanwhile (the message gone from under it).
      if (editingShown.current === message.id) setError(errorText(err));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const submit = async () => {
    if (sendingRef.current) return;
    if (editing) {
      await save(editing);
      return;
    }
    if (blank) return;
    sendingRef.current = true;
    const typed = draft;
    const quoted = replyTo;
    setDraft("");
    setError(null);
    setSending(true);
    if (quoted) onCancelReply();
    try {
      await send(typed.trim(), quoted?.id ?? "");
    } catch (err) {
      setDraft((typedSince) => restoreDraft(typed, typedSince));
      const quotedNow = replyToRef.current;
      if (quoted && (!quotedNow || quotedNow.id === quoted.id)) onReply(quoted);
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
        <Round label="Attach files" disabled={!!editing} style={raised}>
          <PlusIcon color={theme.text} size={22} />
        </Round>
        <Pressable accessibilityRole="button" onPress={() => setWriting(true)} style={styles.prompt}>
          {editing ? (
            <PencilIcon color={theme.accent} size={16} />
          ) : (
            replyTo && <QuoteReplyIcon color={theme.accent} size={16} />
          )}
          <Text numberOfLines={1} style={draft || replyTo || editing ? styles.draft : styles.placeholder}>
            {draft || (editing ? "Editing message" : replyTo ? `Replying to ${quotedName}` : placeholder)}
          </Text>
        </Pressable>
        {/* A send that failed after the field lost focus: the reason waits in
            the card, so the pill says there is one. */}
        {error && <Text style={styles.failed}>{editing ? "Couldn't save" : "Couldn't send"}</Text>}
      </Surface>
    );
  }

  return (
    <Surface glass={glass} style={styles.card}>
      {editing ? (
        <View style={styles.reply}>
          <PencilIcon color={theme.accent} size={16} />
          <Text numberOfLines={1} style={styles.editingText} testID="edit-strip">
            Editing message
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel editing"
            onPress={onEditDone}
            hitSlop={6}
            style={({ pressed }) => [styles.cancel, raised, pressed && roundStyles.down]}
          >
            <CloseIcon color={theme.text} />
          </Pressable>
        </View>
      ) : (
        replyTo && (
        <View style={styles.reply}>
          <QuoteReplyIcon color={theme.accent} size={16} />
          <Text numberOfLines={1} style={styles.replyText} testID="reply-strip">
            Replying to <Text style={styles.replyName}>{quotedName}</Text> · {messagePreview(replyTo)}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel reply"
            onPress={onCancelReply}
            // Drawn at 32; a 44 touch target.
            hitSlop={6}
            style={({ pressed }) => [styles.cancel, raised, pressed && roundStyles.down]}
          >
            <CloseIcon color={theme.text} />
          </Pressable>
        </View>
        )
      )}
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
        <Round label="Attach files" disabled={!!editing} style={raised}>
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
        {editing ? (
          <Round label="Save" disabled={sending} onPress={submit} style={styles.send}>
            {sending ? <ActivityIndicator color={theme.onAccent} /> : <CheckIcon color={theme.onAccent} size={20} />}
          </Round>
        ) : (
          <Round label="Send" disabled={blank || sending} onPress={submit} style={styles.send}>
            {sending ? <ActivityIndicator color={theme.onAccent} /> : <SendIcon color={theme.onAccent} />}
          </Round>
        )}
      </View>
    </Surface>
  );
});

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
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingLeft: 6,
    },
    placeholder: {
      flexShrink: 1,
      color: theme.textMuted,
      fontSize: 17,
    },
    draft: {
      flexShrink: 1,
      color: theme.text,
      fontSize: 17,
    },
    reply: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: 36,
      paddingLeft: 10,
      paddingRight: 4,
    },
    replyText: {
      flex: 1,
      color: theme.textMuted,
      fontSize: tokens.textUi,
    },
    replyName: {
      color: theme.text,
      fontWeight: "700",
    },
    editingText: {
      flex: 1,
      color: theme.text,
      fontSize: tokens.textUi,
      fontWeight: "700",
    },
    cancel: {
      width: 32,
      height: 32,
      borderRadius: tokens.radiusPill,
      alignItems: "center",
      justifyContent: "center",
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
