import { COMMON_EMOJI, emojiName, searchEmoji } from "@stoop/core/emoji";
import { EMOJI_GROUPS } from "@stoop/core/emojiData";
import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { Animated, FlatList, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { rememberEmoji } from "../../api/emoji";
import { useKeyboardHeight } from "../../hooks/useKeyboardHeight";
import { useSheet } from "../../hooks/useSheet";
import { type Theme, tokens, useTheme } from "../../theme";

// The reaction picker, in the message menu's place when More reactions
// is pressed: web's EmojiPicker as a sheet. A search field over every
// emoji's name and keywords (core/emoji searchEmoji); with nothing
// typed, what this phone used recently (`recent`, read by the menu
// before it opens this, so the grid is drawn final), the curated common
// row and then every group in CLDR order, in a grid of 48pt cells, one
// the reader has already given filled in. A pick toggles that reaction,
// is remembered as recent (api/emoji) and closes the sheet; a second
// tap while it is closing does nothing. The sheet sits on the keyboard
// while the field has it, and above the home indicator otherwise. The
// modal, the scrim and the card above are the menu's; `ref.dismiss`
// closes this sheet from its scrim and back, and with it the modal.

export type EmojiPickerHandle = { dismiss: () => void };

const CELL = 48;
// How much of the screen the sheet takes, and what it leaves above
// itself over the keyboard for the card.
const SHARE = 0.6;
const ABOVE = 96;
// The grid's rows, each one a list item, so only what shows is drawn.
type Row =
  | { key: string; kind: "header"; label: string }
  | { key: string; kind: "cells"; section: string; emojis: string[] }
  | { key: string; kind: "empty"; label: string };

export default forwardRef<
  EmojiPickerHandle,
  {
    shown: Animated.Value;
    recent: string[];
    reacted: (emoji: string) => boolean;
    onPick: (emoji: string) => void;
    onClose: () => void;
  }
>(function EmojiPicker({ shown, recent, reacted, onPick, onClose }, ref) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const window = useWindowDimensions();
  const { dismiss, closing, onLayout, slide, panHandlers } = useSheet(shown, onClose);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  useImperativeHandle(ref, () => ({ dismiss }), [dismiss]);

  const pick = (emoji: string) => {
    if (closing()) return;
    rememberEmoji(emoji).catch(() => {});
    onPick(emoji);
    dismiss();
  };

  const columns = Math.max(1, Math.floor((window.width - 16) / CELL));
  const cell = (window.width - 16) / columns;
  const rows = useMemo(() => {
    const out: Row[] = [];
    const grid = (section: string, emojis: string[]) => {
      for (let start = 0; start < emojis.length; start += columns) {
        out.push({ key: `${section}:${start}`, kind: "cells", section, emojis: emojis.slice(start, start + columns) });
      }
    };
    const trimmed = query.trim();
    if (trimmed) {
      const hits = searchEmoji(trimmed).map((entry) => entry.emoji);
      if (hits.length === 0) out.push({ key: "empty", kind: "empty", label: `No emoji match “${trimmed}”` });
      else grid("search", hits);
      return out;
    }
    if (recent.length > 0) {
      out.push({ key: "recent", kind: "header", label: "Recently used" });
      grid("recent", recent);
    }
    out.push({ key: "common", kind: "header", label: "Common" });
    grid("common", COMMON_EMOJI);
    for (const [name, entries] of EMOJI_GROUPS) {
      out.push({ key: `group:${name}`, kind: "header", label: name });
      grid(name, entries.map(([emoji]) => emoji));
    }
    return out;
  }, [query, recent, columns]);

  const height = Math.min(Math.round(window.height * SHARE), window.height - keyboard - insets.top - ABOVE);
  const bottom = keyboard > 0 ? 8 : Math.max(insets.bottom, 8) + 8;

  return (
    <Animated.View
      style={[styles.sheet, { height, marginBottom: keyboard, paddingBottom: bottom, transform: [{ translateY: slide }] }]}
      accessibilityLabel="Add reaction"
      onLayout={onLayout}
    >
      <View style={styles.header} {...panHandlers}>
        <View style={styles.handle} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Search emoji"
          placeholderTextColor={theme.textMuted}
          accessibilityLabel="Search emoji"
          testID="emoji-search"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          style={[styles.search, focused && styles.searchFocused]}
        />
      </View>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={12}
        renderItem={({ item }) => {
          if (item.kind === "header") return <Text style={styles.section}>{item.label}</Text>;
          if (item.kind === "empty") return <Text style={styles.empty}>{item.label}</Text>;
          return (
            <View style={styles.row}>
              {item.emojis.map((emoji) => {
                const on = reacted(emoji);
                return (
                  <Pressable
                    key={emoji}
                    accessibilityRole="button"
                    accessibilityLabel={emojiName(emoji)}
                    accessibilityState={{ selected: on }}
                    testID={`${item.section}:${emoji}`}
                    onPress={() => pick(emoji)}
                    style={({ pressed }) => [styles.cell, { width: cell }, on && styles.reacted, pressed && styles.down]}
                  >
                    <Text style={styles.emoji}>{emoji}</Text>
                  </Pressable>
                );
              })}
            </View>
          );
        }}
      />
    </Animated.View>
  );
});

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    sheet: {
      paddingTop: 8,
      paddingHorizontal: 8,
      borderTopLeftRadius: tokens.radiusLg,
      borderTopRightRadius: tokens.radiusLg,
      backgroundColor: theme.panel,
    },
    header: {
      paddingBottom: 8,
    },
    handle: {
      alignSelf: "center",
      width: 36,
      height: 5,
      marginBottom: 12,
      borderRadius: tokens.radiusPill,
      backgroundColor: theme.border,
    },
    search: {
      height: 44,
      paddingHorizontal: 12,
      borderRadius: tokens.radiusMd,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.raised,
      color: theme.text,
      fontSize: tokens.textBody,
    },
    searchFocused: {
      borderColor: theme.accent,
    },
    section: {
      paddingHorizontal: 4,
      paddingTop: 12,
      paddingBottom: 4,
      color: theme.textMuted,
      fontSize: tokens.textXs,
      fontWeight: "600",
      letterSpacing: 0.6,
      textTransform: "uppercase",
    },
    empty: {
      paddingHorizontal: 4,
      paddingVertical: 12,
      color: theme.textMuted,
      fontSize: tokens.textUi,
    },
    row: {
      flexDirection: "row",
    },
    cell: {
      height: CELL,
      borderRadius: tokens.radiusLg,
      alignItems: "center",
      justifyContent: "center",
    },
    reacted: {
      backgroundColor: theme.accentSoft,
    },
    down: {
      backgroundColor: theme.hover,
    },
    emoji: {
      fontSize: 26,
    },
  });
}
