import { docToLines, type EditorLine, linesToDoc } from "@stoop/core/editor/lines";
import { fromMarkdown, toMarkdown } from "@stoop/core/editor/markdown";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import {
  type EditorSelection,
  type EditorStyle,
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
    // The caret and the text before it on its line, after each change or
    // move; `before` is null while a range is selected.
    onCaret: (before: string | null) => void;
    onBlur: () => void;
    placeholder: string;
    label: string;
    testID?: string;
    autoFocus?: boolean;
    minHeight: number;
    maxHeight: number;
    style?: StyleProp<ViewStyle>;
  }
>(function RichField(
  { value, loadKey, onChange, onCaret, onBlur, placeholder, label, testID, autoFocus, minHeight, maxHeight, style },
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
      commit: async () => {
        const lines = await native.current?.commit();
        return lines ? toMd(lines) : value;
      },
    }),
    [value],
  );

  if (!richEditor) return null;
  const caret = (event: EditorSelection) =>
    onCaret(event.selection.start === event.selection.end ? event.before : null);

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
      }}
      onEditorSelection={({ nativeEvent }) => {
        if (nativeEvent.revision === document.revision) caret(nativeEvent);
      }}
      onEditorHeight={({ nativeEvent }) => setHeight(nativeEvent.height)}
      onEditorFocus={() => fieldFocused(focusKey)}
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
