import { docToLines, type EditorLine, linesToDoc } from "@stoop/core/editor/lines";
import type { Format } from "@stoop/core/editor/formats";
import type { MentionRef } from "@stoop/core/mentions";
import { fromMarkdown, toMarkdown } from "@stoop/core/editor/markdown";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import {
  type EditorSelection,
  type EditorStyle,
  type LinkDraft,
  type RichEditorMethods,
  richEditor,
} from "../../../modules/stoop-rich-text";
import { markdown, type Theme, useTheme } from "../../theme";
import { fieldBlurred, fieldFocused, registerField } from "./fieldFocus";

// The composer's field: the native rich text editor (RichEditorView in
// modules/stoop-rich-text), holding the draft as formatted text, its
// markers never shown. The composer holds the draft as Markdown, as it
// did the plain field's text: every change comes back as Markdown
// (core/editor: lines → document → toMarkdown), and a draft the composer
// puts in from outside (an edit begun or ended, a send clearing it, a
// refused send's words) is loaded into the field, each time `loadKey`
// changes. Typing never waits on this: the field keeps its
// own text and only reports it.
//
// The field grows with its text up to `maxHeight`, then scrolls.

export type RichFieldHandle = {
  focus: () => void;
  blur: () => void;
  // The `count` characters before the caret replaced by text, as typed.
  replaceBeforeCaret: (count: number, text: string) => void;
  // A format on or off, at the caret or over the selection.
  format: (format: Format) => void;
  // The `count` characters before the caret replaced by a pill, then
  // `after`.
  insertMention: (count: number, mention: MentionRef, after: string) => void;
  // The words `typed` at `location` made a pill, if still there.
  markMention: (location: number, typed: string, mention: MentionRef) => void;
  // The link dialog's starting values (null where links can't go), and
  // its Save and Remove over the range it opened with.
  linkDraft: () => Promise<LinkDraft | null>;
  setLink: (text: string, href: string) => void;
  removeLink: () => void;
  // The draft as it stands, a word still being composed taken as is.
  commit: () => Promise<string>;
};

const toMd = (lines: EditorLine[]) => toMarkdown(linesToDoc(lines));

export default forwardRef<
  RichFieldHandle,
  {
    value: string;
    // Changed by the composer each time it puts a draft in from outside.
    loadKey: number;
    onChange: (markdown: string) => void;
    // After a change, the caret collapsed: its line up to it, and where
    // the caret is, for a handle just typed in full to become a pill.
    onTyped?: (before: string, caret: number) => void;
    // After each change or move: the text before the caret on its line
    // (null while a range is selected), and the formats in effect.
    onCaret: (before: string | null, formats: Format[]) => void;
    onBlur: () => void;
    onFocus?: () => void;
    placeholder: string;
    label: string;
    testID?: string;
    autoFocus?: boolean;
    minHeight: number;
    maxHeight: number;
    style?: StyleProp<ViewStyle>;
  }
>(function RichField(
  { value, loadKey, onChange, onTyped, onCaret, onBlur, onFocus, placeholder, label, testID, autoFocus, minHeight, maxHeight, style },
  ref,
) {
  const theme = useTheme();
  const editorStyle = useMemo(() => styleOf(theme), [theme]);
  const native = useRef<RichEditorMethods>(null);
  const [height, setHeight] = useState(minHeight);
  // What the field was last loaded with, as the document prop: a new
  // revision each time the composer puts a draft in (props reach a native
  // view before it is shown, which a command may not). A change the field
  // reports from an earlier revision was on its way as this one loaded,
  // and is dropped.
  const loaded = useRef<{ key: number; revision: number; lines: EditorLine[] } | null>(null);
  if (!loaded.current || loaded.current.key !== loadKey) {
    loaded.current = { key: loadKey, revision: loadKey + 1, lines: docToLines(fromMarkdown(value)) };
  }
  const document = loaded.current;
  // The caret's line up to it at the last change, to tell typing from
  // deleting.
  const typedBefore = useRef("");
  // The field in React Native's focus registry, so a tap on the timeline
  // or Keyboard.dismiss puts it away as it would a TextInput.
  const focusKey = useRef({}).current;
  useEffect(() => registerField(focusKey, () => native.current?.blur()), [focusKey]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => void native.current?.focus(),
      blur: () => void native.current?.blur(),
      replaceBeforeCaret: (count, text) => void native.current?.replaceBeforeCaret(count, text),
      format: (format) => void native.current?.format(format),
      insertMention: (count, mention, after) => void native.current?.insertMention(count, mention, after),
      markMention: (location, typed, mention) => void native.current?.markMention(location, typed, mention),
      linkDraft: async () => (await native.current?.linkDraft()) ?? null,
      setLink: (text, href) => void native.current?.setLink(text, href),
      removeLink: () => void native.current?.removeLink(),
      commit: async () => {
        const lines = await native.current?.commit();
        return lines ? toMd(lines) : value;
      },
    }),
    [value],
  );

  if (!richEditor) return null;
  const caret = (event: EditorSelection) =>
    onCaret(event.selection.start === event.selection.end ? event.before : null, event.formats as Format[]);

  return (
    <richEditor.View
      ref={native}
      editorStyle={editorStyle}
      placeholder={placeholder}
      label={label}
      fieldId={testID}
      autoFocus={autoFocus}
      document={document}
      onEditorChange={({ nativeEvent }) => {
        if (nativeEvent.revision !== document.revision) return;
        onChange(toMd(nativeEvent.lines));
        caret(nativeEvent);
        // Only when something was typed: a backspace that leaves "@dee "
        // before the caret didn't just finish a handle.
        const { start, end } = nativeEvent.selection;
        const grew = nativeEvent.before.length > typedBefore.current.length;
        typedBefore.current = nativeEvent.before;
        if (start === end && grew) onTyped?.(nativeEvent.before, start);
      }}
      onEditorSelection={({ nativeEvent }) => {
        if (nativeEvent.revision === document.revision) caret(nativeEvent);
      }}
      onEditorHeight={({ nativeEvent }) => setHeight(nativeEvent.height)}
      onEditorFocus={() => {
        fieldFocused(focusKey);
        onFocus?.();
      }}
      onEditorBlur={() => {
        fieldBlurred(focusKey);
        onBlur();
      }}
      style={[style, { height: Math.max(minHeight, Math.min(height, maxHeight)) }]}
    />
  );
});

// The look, from the theme and the timeline's Markdown values, so the
// field draws a format as a message does.
function styleOf(theme: Theme): EditorStyle {
  return {
    textColor: theme.text,
    mutedColor: theme[markdown.quoteColor],
    accentColor: theme.accent,
    mentionFill: theme[markdown.mentionBg],
    raised: theme[markdown.codeBg],
    border: theme[markdown.preBorderColor],
    hatch: theme.scheme === "dark" ? "rgba(255, 255, 255, 0.07)" : "rgba(0, 0, 0, 0.07)",
    placeholderColor: theme.textMuted,
    fontSize: 17,
    lineHeight: 23,
    codeScale: markdown.codeScale,
    quoteBarWidth: markdown.quoteBarWidth,
    quotePadX: markdown.quotePadX,
    listIndent: markdown.listIndent,
    prePadX: markdown.prePadX,
    radius: 4,
    fillPad: 2,
  };
}
