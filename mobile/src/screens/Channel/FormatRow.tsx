import type { ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { BulletListIcon, LinkIcon, NumberedListIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";

// The formatting row above the composer's buttons, opened by Aa: the
// browser composer's eleven formats (web/src/components/FormatToolbar),
// in its order and with its labels, scrolling sideways where they don't
// fit. Placement only for now: none of them does anything yet.
const MONO = Platform.select({ ios: "Menlo", default: "monospace" });
const SERIF = Platform.select({ ios: "Georgia", default: "serif" });

export default function FormatRow() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const formats: { label: string; glyph: ReactNode }[] = [
    { label: "Bold", glyph: <Text style={[styles.glyph, styles.bold]}>B</Text> },
    { label: "Italic", glyph: <Text style={[styles.glyph, styles.italic]}>I</Text> },
    { label: "Underline", glyph: <Text style={[styles.glyph, styles.underline]}>U</Text> },
    { label: "Strikethrough", glyph: <Text style={[styles.glyph, styles.strike]}>S</Text> },
    { label: "Inline code", glyph: <Text style={[styles.glyph, styles.mono]}>{"</>"}</Text> },
    { label: "Spoiler", glyph: <Text style={[styles.glyph, styles.spoiler]}>▚</Text> },
    { label: "Link", glyph: <LinkIcon color={theme.text} /> },
    { label: "Quote", glyph: <Text style={[styles.glyph, styles.quote]}>❝</Text> },
    { label: "Bulleted list", glyph: <BulletListIcon color={theme.text} /> },
    { label: "Numbered list", glyph: <NumberedListIcon color={theme.text} /> },
    { label: "Code block", glyph: <Text style={[styles.glyph, styles.mono]}>{"{ }"}</Text> },
  ];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      contentContainerStyle={styles.row}
    >
      {formats.map((format) => (
        <Pressable
          key={format.label}
          accessibilityRole="button"
          accessibilityLabel={format.label}
          style={styles.button}
        >
          {format.glyph}
        </Pressable>
      ))}
    </ScrollView>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
    },
    button: {
      width: 40,
      height: 40,
      borderRadius: tokens.radiusPill,
      alignItems: "center",
      justifyContent: "center",
    },
    glyph: {
      color: theme.text,
      fontSize: 17,
      fontWeight: "500",
    },
    bold: {
      fontWeight: "700",
    },
    italic: {
      fontStyle: "italic",
    },
    underline: {
      textDecorationLine: "underline",
    },
    strike: {
      textDecorationLine: "line-through",
    },
    mono: {
      fontFamily: MONO,
      fontSize: 14,
    },
    spoiler: {
      fontSize: 15,
    },
    quote: {
      fontFamily: SERIF,
      fontSize: 22,
    },
  });
}
