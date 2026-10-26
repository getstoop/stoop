import { Platform, StyleSheet } from "react-native";
import { markdown, type Theme, tokens } from "../../theme";

const MONO = Platform.select({ ios: "Menlo", default: "monospace" });

// A message's text and blocks, drawn with web's Markdown values
// (markdown.css, through theme/generated.ts) in the current theme's
// colours. Nested text draws no padding or rounded corners, so the
// pills' and inline code's pad-x and radius have nowhere to go. The
// quote's and a list row's room beside their words is counted for their
// paragraphs' widths in blocks.ts (QUOTE_INDENT, rowIndent).
export function makeStyles(theme: Theme) {
  const body = tokens.textBody;
  const emojiOnly = body * markdown.emojiOnlyScale;
  const pre = body * markdown.preScale;
  return StyleSheet.create({
    text: {
      color: theme.text,
      fontSize: body,
      lineHeight: body * tokens.leadingBody,
    },
    emojiOnly: {
      fontSize: emojiOnly,
      lineHeight: emojiOnly * tokens.leadingTight,
    },
    bold: {
      fontWeight: "700",
    },
    italic: {
      fontStyle: "italic",
    },
    code: {
      fontFamily: MONO,
      fontSize: body * markdown.codeScale,
      backgroundColor: theme[markdown.codeBg],
    },
    link: {
      color: theme[markdown.linkColor],
    },
    mention: {
      color: theme[markdown.mentionColor],
      backgroundColor: theme[markdown.mentionBg],
      fontWeight: markdown.mentionWeight,
    },
    mentionMe: {
      color: theme[markdown.mentionMeColor],
      backgroundColor: theme[markdown.mentionMeBg],
    },
    covered: {
      color: "transparent",
      backgroundColor: theme[markdown.spoilerBg],
    },
    revealed: {
      backgroundColor: theme[markdown.spoilerBg],
    },
    edited: {
      color: theme.textMuted,
      fontSize: tokens.textSm,
    },
    muted: {
      color: theme[markdown.quoteColor],
    },
    quote: {
      borderLeftWidth: markdown.quoteBarWidth,
      borderLeftColor: theme[markdown.quoteBarColor],
      paddingVertical: markdown.quotePadY,
      paddingHorizontal: markdown.quotePadX,
    },
    // A list row's marker, outside its words as a browser draws it: its
    // box (List) ends where the words start, and the marker sits at that
    // end, as wide as it is.
    markerBox: {
      position: "absolute",
      top: 0,
      alignItems: "flex-end",
    },
    marker: {
      color: theme.text,
      fontSize: body,
      lineHeight: body * tokens.leadingBody,
    },
    pre: {
      borderWidth: markdown.preBorderWidth,
      borderColor: theme[markdown.preBorderColor],
      borderRadius: tokens.radius,
      backgroundColor: theme[markdown.preBg],
      overflow: "hidden",
    },
    // The scroll's content fills the box, so a press anywhere in it is
    // the code's.
    preScroll: {
      flexGrow: 1,
    },
    preContent: {
      flexGrow: 1,
      paddingVertical: markdown.prePadY,
      paddingHorizontal: markdown.prePadX,
    },
    preText: {
      fontFamily: MONO,
      fontSize: pre,
      lineHeight: pre * tokens.leadingBody,
      color: theme.text,
    },
  });
}

export type Styles = ReturnType<typeof makeStyles>;

// Underline and strike-through together, as a span inside the other has
// both: a child's decoration replaces its parent's rather than adding to it.
export function decoration(underline: boolean, strike: boolean) {
  if (underline && strike) return { textDecorationLine: "underline line-through" } as const;
  if (underline) return { textDecorationLine: "underline" } as const;
  if (strike) return { textDecorationLine: "line-through" } as const;
  return undefined;
}
