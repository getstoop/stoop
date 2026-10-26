import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { markdown, type Theme, tokens, useTheme } from "../../theme";

// Web's file card, the frame a file that isn't drawn inline gets: its
// icon, its name and, in the size's slot, its size or what is happening
// to it, on the panel behind a 1px border, at least a finger tall.
// `progress` (0 to 1) draws a thin accent line along its foot while it
// downloads. Without `onPress` it is words only, as the expired
// placeholder is (`dashed`, in the muted colour).
export default function Card({
  icon,
  name,
  meta,
  label,
  hint,
  progress,
  dashed = false,
  onPress,
  onLongPress,
  testID,
}: {
  icon: ReactNode;
  name?: string;
  meta: string;
  label: string;
  hint?: string;
  progress?: number;
  dashed?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  testID?: string;
}) {
  const styles = makeStyles(useTheme());
  const content = (
    <>
      {icon}
      {name !== undefined && (
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
      )}
      <Text style={dashed ? styles.expired : styles.meta} numberOfLines={1}>
        {meta}
      </Text>
      {progress !== undefined && (
        <View style={[styles.progress, { width: `${Math.round(progress * 100)}%` }]} pointerEvents="none" />
      )}
    </>
  );
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={label} testID={testID} style={[styles.card, dashed && styles.dashed]}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.card, pressed && styles.down]}
    >
      {content}
    </Pressable>
  );
}

// Web's .attachment-card; the phone's 44 for the finger.
const MIN_HEIGHT = 44;
const PROGRESS = 2;

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    card: {
      alignSelf: "flex-start",
      maxWidth: "100%",
      minHeight: MIN_HEIGHT,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: markdown.attachmentCardPadY,
      paddingHorizontal: markdown.attachmentCardPadX,
      borderRadius: tokens.radiusMd,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.panel,
      overflow: "hidden",
    },
    dashed: {
      borderStyle: "dashed",
      backgroundColor: "transparent",
    },
    // As a reaction chip takes a press.
    down: {
      opacity: 0.85,
    },
    name: {
      flexShrink: 1,
      color: theme.text,
      fontSize: tokens.textUi,
      fontWeight: "600",
    },
    meta: {
      flexShrink: 0,
      color: theme.textMuted,
      fontSize: tokens.textSm,
    },
    expired: {
      color: theme.textMuted,
      fontSize: tokens.textUi,
    },
    progress: {
      position: "absolute",
      left: 0,
      bottom: 0,
      height: PROGRESS,
      backgroundColor: theme.accent,
    },
  });
}
