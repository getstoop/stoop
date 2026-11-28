import { Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronRightIcon, FileIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";

// The way to your own notes, the conversation with only you in it: a
// button of its own above the people, not a person to pick. You are in
// every conversation already, so a row for you among the people would
// read as someone to add (as web's New conversation).
export default function NotesEntry({ disabled, onOpen }: { disabled: boolean; onOpen: () => void }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Your notes, a conversation with only you in it"
      accessibilityState={{ disabled }}
      disabled={disabled}
      testID="your-notes"
      onPress={onOpen}
      style={({ pressed }) => [styles.entry, disabled && styles.off, pressed && styles.pressed]}
    >
      <View style={styles.icon}>
        <FileIcon color={theme.accent} size={20} />
      </View>
      <View style={styles.words}>
        <Text style={styles.name} numberOfLines={1}>
          Your notes
        </Text>
        <Text style={styles.about} numberOfLines={1}>
          A conversation with only you in it
        </Text>
      </View>
      <ChevronRightIcon color={theme.textMuted} />
    </Pressable>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    entry: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 64,
      marginTop: 4,
      marginBottom: 8,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: tokens.radiusLg,
      backgroundColor: theme.panel,
    },
    off: {
      opacity: 0.4,
    },
    pressed: {
      backgroundColor: theme.hover,
    },
    icon: {
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: tokens.radiusMd,
      backgroundColor: theme.surface,
    },
    words: {
      flex: 1,
      minWidth: 0,
      gap: 1,
    },
    name: {
      color: theme.text,
      fontSize: tokens.textBody,
      fontWeight: "600",
    },
    about: {
      color: theme.textMuted,
      fontSize: tokens.textSm,
    },
  });
}
