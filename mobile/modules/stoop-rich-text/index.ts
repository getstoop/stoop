import { requireNativeView, requireOptionalNativeModule } from "expo";
import type { EditorLine } from "@stoop/core/editor/lines";
import type { Ref } from "react";
import type { NativeSyntheticEvent, ViewProps } from "react-native";

// One styled run of a message's words (RichLayout.swift RichRun on iOS,
// RichDoc.kt on Android).
export type RichRun = {
  text: string;
  size: number;
  weight?: number;
  italic?: boolean;
  mono?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  link?: string;
  linkId?: number;
  linkHidden?: boolean;
  fill?: string;
  fillId?: number;
  fillPad?: number;
  spoiler?: number;
  covered?: boolean;
  spoilerFill?: string;
};

export type RichDoc = {
  runs: RichRun[];
  lineHeight: number;
  bodySize: number;
  textColor: string;
  spoilerPad: number;
  radius: number;
  label: string;
  // False in the message menu's card: covered spoilers take no tap and
  // the paragraph offers no reveal.
  revealable: boolean;
};

export type RichTextProps = ViewProps & {
  doc: RichDoc;
  onPressLink?: (event: NativeSyntheticEvent<{ url: string }>) => void;
  onReveal?: (event: NativeSyntheticEvent<{ id: number }>) => void;
};

type Native = { measure(doc: RichDoc, width: number): number };

// The module is built for iOS and Android (expo-module.config.json);
// anywhere else without it, this is null and messages are drawn with
// React Native's Text instead.
const native = requireOptionalNativeModule<Native>("StoopRichText");

export const richText = native
  ? {
      // The paragraph's height at a width, synchronously.
      measure: (doc: RichDoc, width: number) => native.measure(doc, width),
      View: requireNativeView<RichTextProps>("StoopRichText"),
    }
  : null;

// The composer's field (RichEditorView.swift, RichEditorView.kt): the draft
// as lines (core/editor/lines.ts), drawn formatted. RichField.tsx is its
// React face.
export type EditorStyle = {
  textColor: string;
  mutedColor: string;
  accentColor: string;
  mentionFill: string;
  raised: string;
  border: string;
  hatch: string;
  placeholderColor: string;
  fontSize: number;
  lineHeight: number;
  codeScale: number;
  quoteBarWidth: number;
  quotePadX: number;
  listIndent: number;
  prePadX: number;
  radius: number;
  fillPad: number;
};

// The caret, and the caret's line up to it, each mention's words as
// U+FFFC so a query can't start inside one.
export type EditorSelection = {
  // The document revision the field held (RichEditorProps.document).
  revision: number;
  selection: { start: number; end: number };
  before: string;
};

export type EditorChange = EditorSelection & { lines: EditorLine[] };

export type RichEditorProps = ViewProps & {
  ref?: Ref<RichEditorMethods>;
  editorStyle: EditorStyle;
  placeholder: string;
  label: string;
  fieldId?: string;
  autoFocus?: boolean;
  // Text put in from outside, loaded each time its revision changes.
  document: { revision: number; lines: EditorLine[] };
  onEditorChange?: (event: NativeSyntheticEvent<EditorChange>) => void;
  onEditorSelection?: (event: NativeSyntheticEvent<EditorSelection>) => void;
  onEditorHeight?: (event: NativeSyntheticEvent<{ height: number }>) => void;
  onEditorFocus?: () => void;
  onEditorBlur?: () => void;
};

// What JS can ask of the field, through its ref.
export type RichEditorMethods = {
  focus(): Promise<void>;
  blur(): Promise<void>;
  replaceBeforeCaret(count: number, text: string): Promise<void>;
  commit(): Promise<EditorLine[]>;
};

export const richEditor = native
  ? { View: requireNativeView<RichEditorProps>("StoopRichText", "RichEditorView") }
  : null;
