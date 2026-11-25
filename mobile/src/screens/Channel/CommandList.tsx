import type { Command } from "@stoop/core/commands";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { avatarRadius } from "../../components/Avatar";
import { type Theme, useTheme } from "../../theme";
import Surface from "./Surface";

// The slash commands a draft of "/" and letters matches (core/commands),
// drawn over the composer's card as the mention list is, in its surface
// and its rows: a "/" mark in the avatar's column, the name with what may
// follow it, and what it does under them. No row is chosen ahead: only a
// tap picks, as Return makes a new line.

const ROW = 52;
// Four rows and half the next, so a list that scrolls says so.
const SHOWN = 4.5;
const MONO = Platform.select({ ios: "Menlo", default: "monospace" });

export default function CommandList({
  commands,
  onPick,
}: {
  commands: Command[];
  onPick: (command: Command) => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const glass = Platform.OS === "ios" && isLiquidGlassAvailable();

  return (
    <Surface glass={glass} style={styles.list}>
      <ScrollView keyboardShouldPersistTaps="always" testID="command-list">
        {commands.map((command) => (
          <Pressable
            key={command.name}
            accessibilityRole="button"
            accessibilityLabel={`/${command.name}, ${command.description}`}
            onPress={() => onPick(command)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={[styles.mark, glass ? styles.glassMark : styles.solidMark]}>
              <Text style={styles.markText}>/</Text>
            </View>
            <View style={styles.words}>
              <Text numberOfLines={1} style={styles.name}>
                /{command.name}
                <Text style={styles.hint}> {command.hint}</Text>
              </Text>
              <Text numberOfLines={1} style={styles.description}>
                {command.description}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </Surface>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    list: {
      maxHeight: ROW * SHOWN + 8,
      borderRadius: 20,
      padding: 4,
    },
    row: {
      minHeight: ROW,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 14,
    },
    pressed: {
      backgroundColor: theme.accentSoft,
    },
    // The mark in the avatar's column, in the mention list's shape.
    mark: {
      width: 32,
      height: 32,
      borderRadius: avatarRadius(32),
      alignItems: "center",
      justifyContent: "center",
    },
    solidMark: {
      backgroundColor: theme.raised,
    },
    // On glass a solid mark reads as a hole: the composer's translucent one.
    glassMark: {
      backgroundColor: theme.scheme === "dark" ? "rgba(255, 255, 255, 0.10)" : "rgba(0, 0, 0, 0.06)",
    },
    markText: {
      color: theme.textMuted,
      fontFamily: MONO,
      fontSize: 15,
      fontWeight: "700",
    },
    words: {
      flex: 1,
      gap: 1,
    },
    name: {
      color: theme.text,
      fontFamily: MONO,
      fontSize: 15,
      fontWeight: "700",
    },
    hint: {
      color: theme.textMuted,
      fontSize: 13,
      fontWeight: "400",
    },
    description: {
      color: theme.textMuted,
      fontSize: 13,
    },
  });
}
