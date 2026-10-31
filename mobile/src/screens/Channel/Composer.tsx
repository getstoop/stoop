import type { UploadedFile } from "@stoop/core/attachments";
import type { Format } from "@stoop/core/editor/formats";
import { fromMarkdown, toMarkdown } from "@stoop/core/editor/markdown";
import { isBlankMessage, plainText } from "@stoop/core/markdown";
import { MAX_MESSAGE_LENGTH, typedMentionEnding, withTypedMentions, writtenLength } from "@stoop/core/mentions";
import { messagePreview } from "@stoop/core/messagePreview";
import { restoreDraft } from "@stoop/core/unsent";
import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { forwardRef, type ReactNode, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { authorName } from "../../api/authors";
import { errorText } from "../../api/errors";
import type { LocalFile } from "../../api/files";
import { CheckIcon, CloseIcon, PencilIcon, PlusIcon, QuoteReplyIcon, SendIcon } from "../../components/Icons";
import type { LinkDraft } from "../../../modules/stoop-rich-text";
import { type Theme, tokens, useTheme } from "../../theme";
import AlsoSendRow from "./AlsoSendRow";
import AttachmentCount from "./AttachmentCount";
import AttachmentStrip from "./AttachmentStrip";
import AttachSheet from "./AttachSheet";
import FormatRow from "./FormatRow";
import LinkDialog from "./LinkDialog";
import RichField, { type RichFieldHandle } from "./RichField";
import Surface from "./Surface";
import { useAttachments } from "./useAttachments";
import type { ComposerMentions } from "./useMentionNames";
import { useMentionQuery } from "./useMentionQuery";

// Where a message is written: one control in two states. At rest it is a
// pill floating over the list, Attach and "Message #channel"; tapped, it
// becomes a card above the keyboard, the text on top and under it
// Attach, Aa (which opens the formatting row) and Send. Losing focus
// returns it to the pill, the draft kept. The text is the native rich
// text field (RichField), which shows a draft formatted, its markers
// never; the draft is held here as Markdown, and the pill shows it as
// plain words. The formats are placed for the step that gives them work.
//
// Attach, in either state, puts the keyboard away and opens the attach
// sheet (AttachSheet); the photo library, the camera or files picked
// there opens that system picker once the sheet has gone (pickers.ts),
// and the card comes back with what was
// picked along its top (AttachmentStrip), each uploading as it arrives
// (useAttachments). Send waits, dimmed and saying so to a screen reader,
// while any is uploading; one that failed is left out of the send, and a
// message may be files alone. With the keyboard down the pill shows a
// paperclip and how many files are held, before the draft. A refused
// send puts its files back with the draft, ahead of any picked since.
//
// A message being quoted (`replyTo`, the screen's to hold) is the card's
// first line, the reply strip: "Replying to NAME · the first words", and
// Cancel reply, which drops it and keeps the draft. The pill says
// "Replying to NAME" with the strip's arrow, or the draft under that
// arrow, so the quote shows while the keyboard is down. `ref.open` puts
// the card up with the field focused, as a quote picked from the
// message menu does once the menu has gone.
//
// Sending is send-then-merge, never a pending row: the draft, the files
// and the quote are cleared as Send is pressed and the row appears when the
// server answers (or its event lands first; core/channelScreen `sent`).
// A refusal puts the draft back ahead of anything typed since, with the
// server's words under it, and the quote back unless another was picked
// meanwhile (web's rule); pressing Send again is the retry.
//
// Typing a @handle or #name in the card lists who or what it may name over
// the card (useMentionQuery, MentionList), and a pick puts a pill in the
// field, one unit to the caret and to a backspace; the @ button beside Aa
// types an "@" that opens the list. A @handle or #name typed in full that
// exactly one person, group or channel has becomes a pill as the word
// ends (core/mentions typedMentionEnding), as web's editor makes one, and
// any left as words go as their tokens on send (withTypedMentions).
//
// In a thread (`inThread`) the pill says "Reply in thread", and the card
// has "Also send to #channel" over the field, a checkbox that sends the
// reply to the channel's timeline as well. As on web it is cleared by
// each send and set again by a refusal.
//
// A message being edited (`editing`, the screen's to hold, never
// together with a quote) puts the composer in editing mode: the draft
// is set aside, the field holds the message,
// the strip says "Editing message" with Cancel editing, Attach is dimmed
// and the files held are out of sight, since an edit changes words only,
// and Send is Save; the pill says
// "Editing message" under the pencil while the keyboard is down. The
// field loads the message's Markdown as it is stored, its mentions as
// mentions, and Save sends what the field holds as EditMessage; the
// answer merges like a send's. Words unchanged (the content, or the
// content as the field writes it back) end the
// edit with no request; none at all are refused with web's wording, the
// edit going on; a refusal keeps the edited words with the server's
// under them, and Cancel editing waits for the answer. Editing ends on
// Save, Cancel editing, or the screen letting the message go (deleted,
// or quoted instead), and the set-aside draft comes back each way. A
// copy of the same message arriving edited elsewhere leaves the field's
// words alone; saving then replaces it, as on web. A send refused while
// an edit is open puts its words into the draft set aside, never into
// the field, and its reason waits for the edit to end.

// The pill's height and the gap under it, for the screen to keep the
// list's newest message clear of it.
export const PILL = 48;
export const GAP = 8;

const MAX_LINES = 6;

export type ComposerHandle = { open: () => void };

export default forwardRef<
  ComposerHandle,
  {
    // #name, or a conversation's title (core headerPlace), for "Message …".
    place: string;
    // Who and what a handle typed here names, and the server and session
    // the list's avatars are fetched with.
    mentionNames: ComposerMentions;
    origin: string;
    token: string;
    // A thread's composer, with Also send to the channel.
    inThread?: boolean;
    send: (content: string, replyToMessageId: string, alsoSend: boolean, attachmentIds: string[]) => Promise<void>;
    // A picked file, uploaded for this channel; and the server's cap on one.
    upload: (file: LocalFile, signal: AbortSignal) => Promise<UploadedFile>;
    maxUploadBytes: number;
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
>(function Composer(
  { place, mentionNames, origin, token, inThread = false, send, upload, maxUploadBytes, edit, replyTo, onCancelReply, onReply, editing, onEditDone },
  ref,
) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [draft, setDraft] = useState("");
  // Counts the drafts put in the field from outside, so it loads each
  // (RichField loadKey), even one whose Markdown is what it already holds.
  const [loads, setLoads] = useState(0);
  const putDraft = (text: string | ((typedSince: string) => string)) => {
    setDraft(text);
    setLoads((count) => count + 1);
  };
  const [writing, setWriting] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [sending, setSending] = useState(false);
  const [alsoSend, setAlsoSend] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The caret's line up to the caret, for the mention list, and the
  // formats in effect there, for the format row.
  const [before, setBefore] = useState<string | null>(null);
  const [formats, setFormats] = useState<Format[]>([]);
  // The files held, and the attach sheet; back to the card after a pick.
  const attachments = useAttachments(upload, maxUploadBytes, () => openCard());
  const input = useRef<RichFieldHandle>(null);
  // The draft set aside while a message is edited, to come back after,
  // and a send's refusal that waits with it.
  const setAside = useRef("");
  const heldError = useRef<string | null>(null);
  // Which message the field holds for editing, so a change of it (in,
  // out, or to another message) is taken in the same render, while a
  // copy of the same one, edited elsewhere, leaves the field alone; and a
  // count of the edits begun, so a Save's answer is only the edit it was
  // pressed in.
  const editingShown = useRef<string | null>(null);
  const session = useRef(0);
  const editingId = editing?.id ?? null;
  if (editingShown.current !== editingId) {
    session.current++;
    if (editingShown.current === null) {
      setAside.current = draft;
      heldError.current = error;
    }
    editingShown.current = editingId;
    if (editing) {
      putDraft(editing.content);
      setError(null);
    } else {
      putDraft(setAside.current);
      setError(heldError.current);
      heldError.current = null;
    }
  }
  // The link dialog is up: the field losing the keyboard to it doesn't
  // close the card.
  const linking = useRef(false);
  // Send pressed again before React commits the sending state must not
  // send twice, so the guard is a ref as well.
  const sendingRef = useRef(false);
  // The quote as it stands when a send's answer lands.
  const replyToRef = useRef(replyTo);
  replyToRef.current = replyTo;
  const glass = Platform.OS === "ios" && isLiquidGlassAvailable();
  const mentions = useMentionQuery({
    before,
    writing,
    names: mentionNames,
    origin,
    token,
    replace: ({ count, text, mention }) =>
      mention ? input.current?.insertMention(count, mention, text) : input.current?.replaceBeforeCaret(count, text),
  });

  // The card, with the field focused: mounted so (autoFocus), and focused
  // once more on the frame after it is up, since Android does not always
  // honour autoFocus on a field mounted as a modal goes; or focused again
  // if it is already up.
  const focusWanted = useRef(false);
  const openCard = () => {
    if (writing) {
      input.current?.focus();
      return;
    }
    focusWanted.current = true;
    setWriting(true);
  };
  useImperativeHandle(ref, () => ({ open: openCard }), [writing]);
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
    const sub = Keyboard.addListener("keyboardDidHide", () => {
      if (!linking.current) input.current?.blur();
    });
    return () => sub.remove();
  }, []);

  const placeholder = editing ? "Edit message" : inThread ? "Reply in thread" : `Message ${place}`;
  const blank = isBlankMessage(draft);
  // Past the server's limit (written characters, a mention as its handle):
  // Send dims, and a line under the field says by how much.
  const over = writtenLength(draft) - MAX_MESSAGE_LENGTH;
  const files = editing ? [] : attachments.files;
  const quotedName = replyTo ? authorName(replyTo.author) : "";

  // Save: what the field holds. The same as the latest copy, as stored or
  // as the field writes it back, ends the edit with nothing sent, as on
  // web; no words are refused. The answer counts only for the edit Save
  // was pressed in: ended, or begun again on the same message, meanwhile,
  // it is nobody's.
  const save = async (message: Message) => {
    const mine = session.current;
    sendingRef.current = true;
    let content: string;
    try {
      content = ((await input.current?.commit()) ?? draft).trim();
    } catch {
      content = draft.trim();
    } finally {
      sendingRef.current = false;
    }
    if (session.current !== mine) return;
    // A handle typed in full and not yet a pill goes as its token, as on
    // send and as web's editor saves it.
    content = withTypedMentions(content, mentionNames);
    if (content === message.content || content === toMarkdown(fromMarkdown(message.content))) {
      onEditDone();
      return;
    }
    if (isBlankMessage(content)) {
      setError("A message can't be empty — delete it instead.");
      return;
    }
    sendingRef.current = true;
    setError(null);
    setSending(true);
    try {
      await edit(message.id, content);
      if (session.current === mine) onEditDone();
    } catch (err) {
      if (session.current === mine) setError(errorText(err));
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
    // Uploads in flight are waited for (Send is dimmed meanwhile); failed
    // files are left out.
    if (attachments.uploading || (blank && !attachments.ready)) return;
    sendingRef.current = true;
    // The field's text as it stands, a word still being composed taken;
    // the draft as last reported if the field can't answer.
    let typed: string;
    try {
      typed = (await input.current?.commit()) ?? draft;
    } catch {
      typed = draft;
    }
    const quoted = replyTo;
    const also = alsoSend;
    const held = attachments.take();
    const attachmentIds = held.flatMap((file) => (file.fileId ? [file.fileId] : []));
    putDraft("");
    setError(null);
    setSending(true);
    setAlsoSend(false);
    if (quoted) onCancelReply();
    try {
      await send(isBlankMessage(typed) ? "" : withTypedMentions(typed.trim(), mentionNames), quoted?.id ?? "", also, attachmentIds);
    } catch (err) {
      setAlsoSend(also);
      attachments.restore(held);
      if (editingShown.current !== null) {
        // An edit has begun meanwhile: the words go into the draft set
        // aside, and the reason waits with them for the edit to end.
        setAside.current = restoreDraft(typed, setAside.current);
        heldError.current = errorText(err);
      } else {
        putDraft((typedSince) => restoreDraft(typed, typedSince));
        setError(errorText(err));
      }
      const quotedNow = replyToRef.current;
      if (quoted && (!quotedNow || quotedNow.id === quoted.id)) onReply(quoted);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  // A format from the row: the inline marks and the blocks, and Link,
  // which opens the link dialog on what the field says it would link. A screen reader hears a mark go on or off, as the
  // field next reports it (a tap that changes nothing says nothing).
  const announcing = useRef<Format | null>(null);
  const applyFormat = (format: Format) => {
    if (format === "link") {
      void openLink();
      return;
    }
    announcing.current = format;
    input.current?.format(format);
  };

  // The link dialog takes the keyboard from the field while it is up; the
  // card stays open meanwhile, and the field has it back after.
  const [link, setLink] = useState<LinkDraft | null>(null);
  const openLink = async () => {
    const opened = await input.current?.linkDraft();
    if (!opened) return;
    linking.current = true;
    setLink(opened);
  };
  // The field has the keyboard back a moment after the dialog goes, and
  // only then does losing it close the card again: on Android the
  // dialog's own field going hides the keyboard for an instant, and the
  // field's focus event can land after the dialog's state has cleared.
  const closeLink = () => {
    setLink(null);
    // On Android the dialog's field going (with the next commit) hides the
    // keyboard; the field takes it back once that has happened.
    if (Platform.OS === "android") {
      setTimeout(() => input.current?.focus(), 100);
    } else {
      input.current?.focus();
    }
    setTimeout(() => {
      linking.current = false;
    }, 1000);
  };

  const raised = glass ? styles.glassRaised : styles.raised;
  const waiting = attachments.uploading && !editing;
  const openAttach = () => attachments.openSheet(writing);
  const sheet = attachments.attaching && <AttachSheet onClose={attachments.sheetClosed} />;

  if (!writing) {
    const words = plainText(draft);
    const shownText = editing ? "Editing message" : words || (replyTo ? `Replying to ${quotedName}` : placeholder);
    return (
      <>
        <Surface glass={glass} style={styles.pill}>
          <Round label="Attach files" disabled={!!editing} onPress={openAttach} style={raised}>
            <PlusIcon color={theme.text} size={22} />
          </Round>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={files.length > 0 ? `${fileCount(files.length)} attached, ${shownText}` : undefined}
            onPress={() => setWriting(true)}
            style={styles.prompt}
          >
            {files.length > 0 && <AttachmentCount count={files.length} style={raised} />}
            {editing ? (
              <PencilIcon color={theme.accent} size={16} />
            ) : (
              replyTo && <QuoteReplyIcon color={theme.accent} size={16} />
            )}
            <Text numberOfLines={1} style={words || replyTo || editing ? styles.draft : styles.placeholder}>
              {shownText}
            </Text>
          </Pressable>
          {/* A send that failed after the field lost focus: the reason waits in
              the card, so the pill says there is one. */}
          {error && <Text style={styles.failed}>{editing ? "Couldn't save" : "Couldn't send"}</Text>}
        </Surface>
        {sheet}
      </>
    );
  }

  return (
    <>
      {link && (
        <LinkDialog
          draft={link}
          onSave={(text, href) => {
            input.current?.setLink(text, href);
            closeLink();
          }}
          onRemove={() => {
            input.current?.removeLink();
            closeLink();
          }}
          onCancel={closeLink}
        />
      )}
      <Surface glass={glass} style={styles.card}>
        {files.length > 0 && <AttachmentStrip files={files} raised={raised} onRemove={attachments.remove} />}
        {attachments.notice && !editing && (
          <Text style={styles.error} accessibilityRole="alert">
            {attachments.notice}
          </Text>
        )}
        {editing ? (
          <View style={styles.reply}>
            <PencilIcon color={theme.accent} size={16} />
            <Text numberOfLines={1} style={styles.editingText} testID="edit-strip">
              Editing message
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel editing"
              accessibilityState={{ disabled: sending }}
              disabled={sending}
              onPress={onEditDone}
              hitSlop={6}
              style={({ pressed }) => [
                styles.cancel,
                raised,
                sending && roundStyles.disabled,
                pressed && roundStyles.down,
              ]}
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
        {inThread && !editing && <AlsoSendRow place={place} checked={alsoSend} onChange={setAlsoSend} />}
        <RichField
          ref={input}
          testID="composer"
          autoFocus
          value={draft}
          loadKey={loads}
          onChange={setDraft}
          onTyped={(line, caret) => {
            const typed = typedMentionEnding(line, mentionNames);
            if (typed) {
              const location = caret - line.length + typed.start;
              input.current?.markMention(location, line.slice(typed.start, typed.start + typed.length), typed.ref);
            }
          }}
          onCaret={(text, active) => {
            setBefore(text);
            setFormats(active);
            const format = announcing.current;
            if (format) {
              announcing.current = null;
              const state = active.includes(format) ? "on" : "off";
              AccessibilityInfo.announceForAccessibility(`${FORMAT_LABELS[format]}, ${state}`);
            }
          }}
          onBlur={() => {
            if (!linking.current) setWriting(false);
          }}
          preparePaste={(text) => withTypedMentions(text, mentionNames)}
          onKey={(key) => {
            if (key === "link") applyFormat("link");
          }}
          placeholder={placeholder}
          label={placeholder}
          minHeight={44}
          maxHeight={11 + 8 + 23 * MAX_LINES}
        />
        {error && (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        )}
        {over > 0 && (
          <Text style={styles.error} accessibilityRole="alert">
            {over === 1 ? "1 character over" : `${over} characters over`}
          </Text>
        )}
        {formatting && (
          <FormatRow
            active={formats}
            onFormat={applyFormat}
            onIndent={(step) => input.current?.format(step > 0 ? "indent" : "outdent")}
          />
        )}
        <View style={styles.buttons}>
          <Round label="Attach files" disabled={!!editing} onPress={openAttach} style={raised}>
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
          <Round label="Mention someone" onPress={mentions.typeAt}>
            <Text style={styles.at}>@</Text>
          </Round>
          <View style={styles.spacer} />
          {editing ? (
            <Round label="Save" disabled={sending || over > 0} onPress={submit} style={styles.send}>
              {sending ? <ActivityIndicator color={theme.onAccent} /> : <CheckIcon color={theme.onAccent} size={20} />}
            </Round>
          ) : (
            <Round
              label={waiting ? "Send, waiting for uploads" : "Send"}
              disabled={(blank && !attachments.ready) || sending || waiting || over > 0}
              onPress={submit}
              style={styles.send}
            >
              {sending ? <ActivityIndicator color={theme.onAccent} /> : <SendIcon color={theme.onAccent} />}
            </Round>
          )}
        </View>
      </Surface>
      {sheet}
    </>
  );
});

const FORMAT_LABELS: Record<Format, string> = {
  bold: "Bold",
  italic: "Italic",
  underline: "Underline",
  strike: "Strikethrough",
  code: "Inline code",
  spoiler: "Spoiler",
  link: "Link",
  quote: "Quote",
  list: "Bulleted list",
  orderedList: "Numbered list",
  codeblock: "Code block",
};

const fileCount = (count: number) => (count === 1 ? "1 file" : `${count} files`);

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
    at: {
      color: theme.text,
      fontSize: 19,
      fontWeight: "600",
    },
    send: {
      backgroundColor: theme.accent,
    },
  });
}
