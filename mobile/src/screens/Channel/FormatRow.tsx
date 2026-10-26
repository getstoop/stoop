import type { Format } from "@stoop/core/editor/formats";
import type { ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { BulletListIcon, LinkIcon, NumberedListIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";

// The formatting row above the composer's buttons, opened by Aa: the
// browser composer's eleven formats (web/src/components/FormatToolbar),
// in its order and with its labels, scrolling sideways where they don't
// fit. A button shows pressed while its format is in effect at the caret
// (or over all of the selection); the inline marks are dimmed in a code
// block, which holds none. Taps keep the field focused.
const MONO = Platform.select({ ios: "Menlo", default: "monospace" });
const SERIF = Platform.select({ ios: "Georgia", default: "serif" });

const MARKS: Format[] = ["bold", "italic", "underline", "strike", "code", "spoiler", "link"];

export default function FormatRow({ active, onFormat }: { active: Format[]; onFormat: (format: Format) => void }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const formats: { format: Format; label: string; glyph: ReactNode }[] = [
    { format: "bold", label: "Bold", glyph: <Text style={[styles.glyph, styles.bold]}>B</Text> },
    { format: "italic", label: "Italic", glyph: <Text style={[styles.glyph, styles.italic]}>I</Text> },
    { format: "underline", label: "Underline", glyph: <Text style={[styles.glyph, styles.underline]}>U</Text> },
    { format: "strike", label: "Strikethrough", glyph: <Text style={[styles.glyph, styles.strike]}>S</Text> },
    { format: "code", label: "Inline code", glyph: <Text style={[styles.glyph, styles.mono]}>{"</>"}</Text> },
    { format: "spoiler", label: "Spoiler", glyph: <Text style={[styles.glyph, styles.spoiler]}>▚</Text> },
    { format: "link", label: "Link", glyph: <LinkIcon color={theme.text} /> },
    { format: "quote", label: "Quote", glyph: <Text style={[styles.glyph, styles.quote]}>❝</Text> },
    { format: "list", label: "Bulleted list", glyph: <BulletListIcon color={theme.text} /> },
    { format: "orderedList", label: "Numbered list", glyph: <NumberedListIcon color={theme.text} /> },
    { format: "codeblock", label: "Code block", glyph: <Text style={[styles.glyph, styles.mono]}>{"{ }"}</Text> },
  ];
  const inCode = active.includes("codeblock");

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      testID="format-row"
      contentContainerStyle={styles.row}
    >
      {formats.map(({ format, label, glyph }) => {
        const pressed = active.includes(format);
        const disabled = inCode && MARKS.includes(format);
        return (
          <Pressable
            key={format}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: pressed, disabled }}
            disabled={disabled}
            onPress={() => onFormat(format)}
            style={({ pressed: down }) => [
              styles.button,
              pressed && styles.pressed,
              disabled && styles.disabled,
              down && styles.down,
            ]}
          >
            {glyph}
          </Pressable>
        );
      })}
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
    pressed: {
      backgroundColor: theme.accentSoft,
    },
    disabled: {
      opacity: 0.35,
    },
    down: {
      opacity: 0.85,
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
