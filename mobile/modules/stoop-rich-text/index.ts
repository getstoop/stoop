import { requireNativeView, requireOptionalNativeModule } from "expo";
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
