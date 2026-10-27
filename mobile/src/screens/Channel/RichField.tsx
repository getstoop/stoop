import { docToLines, type EditorLine, linesToDoc, mentionsAsWords } from "@stoop/core/editor/lines";
import * as Clipboard from "expo-clipboard";
import type { Format } from "@stoop/core/editor/formats";
import { type MentionRef, mentionText } from "@stoop/core/mentions";
import { fromMarkdown, toMarkdown } from "@stoop/core/editor/markdown";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
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
// Paste reads the clipboard's text as Markdown, so a message's source
// pastes back formatted (in a code block it stays literal, natively);
// Copy and Cut put Markdown on the clipboard, mentions as their words.
//
// The field grows with its text up to `maxHeight`, then scrolls.

export type RichFieldHandle = {
  focus: () => void;
  blur: () => void;
  // The `count` characters before the caret replaced by text, as typed.
  replaceBeforeCaret: (count: number, text: string) => void;
  // A format on or off, at the caret or over the selection; or list items
  // a level deeper or up.
  format: (format: Format | "indent" | "outdent") => void;
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

// The characters the lines hold, a mention as its words, a line break as
// one.
function textLength(lines: EditorLine[]): number {
  return lines.reduce(
    (total, line, index) =>
      total +
      (index > 0 ? 1 : 0) +
      line.runs.reduce((sum, run) => sum + ("text" in run ? run.text.length : mentionText(run.mention).length), 0),
    0,
  );
}

// What is sent leaves out empty lines at the end: an empty list item or
// quote line would otherwise go as a lone "-" or ">".
function withoutTrailingEmpty(lines: EditorLine[]): EditorLine[] {
  let end = lines.length;
  while (end > 1 && lines[end - 1].runs.length === 0) end--;
  return lines.slice(0, end);
}

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
    // Pasted text as the Markdown to read (the composer writes handles
    // typed in full as their tokens, so they paste as pills).
    preparePaste?: (text: string) => string;
    // A hardware key left to the composer (⌘K: "link").
    onKey?: (key: string) => void;
    placeholder: string;
    label: string;
    testID?: string;
    autoFocus?: boolean;
    minHeight: number;
    maxHeight: number;
  }
>(function RichField(
  { value, loadKey, onChange, onTyped, onCaret, onBlur, onFocus, preparePaste, onKey, placeholder, label, testID, autoFocus, minHeight, maxHeight },
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
  // The text's length at the last change or load, to tell typing from
  // deleting.
  const typedLength = useRef(0);
  const loadedLength = useRef<number | null>(null);
  if (loadedLength.current !== document.revision) {
    loadedLength.current = document.revision;
    typedLength.current = textLength(document.lines);
  }
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
        return lines ? toMd(withoutTrailingEmpty(lines)) : value;
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
        // Only when the text grew (something was typed): a backspace that
        // leaves "@dee " before the caret didn't just finish a handle. The
        // whole text's length, which the order of the field's caret and
        // change events can't upset.
        const { start, end } = nativeEvent.selection;
        const length = textLength(nativeEvent.lines);
        const grew = length > typedLength.current;
        typedLength.current = length;
        if (start === end && grew) onTyped?.(nativeEvent.before, start);
      }}
      onEditorSelection={({ nativeEvent }) => {
        if (nativeEvent.revision === document.revision) caret(nativeEvent);
      }}
      onEditorHeight={({ nativeEvent }) => setHeight(nativeEvent.height)}
      onEditorPaste={({ nativeEvent }) => {
        const md = preparePaste ? preparePaste(nativeEvent.text) : nativeEvent.text;
        void native.current?.insertLines(docToLines(fromMarkdown(md)));
      }}
      onEditorCopy={({ nativeEvent }) => {
        void Clipboard.setStringAsync(toMd(mentionsAsWords(nativeEvent.lines)));
      }}
      onEditorKey={({ nativeEvent }) => onKey?.(nativeEvent.key)}
      onEditorFocus={() => {
        fieldFocused(focusKey);
        onFocus?.();
      }}
      onEditorBlur={() => {
        fieldBlurred(focusKey);
        onBlur();
      }}
      style={{ height: Math.max(minHeight, Math.min(height, maxHeight)) }}
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
