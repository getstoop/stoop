import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Alert, Pressable, StyleSheet, Text } from "react-native";
import { CopyIcon, TrashIcon } from "../../components/Icons";
import Sheet from "../../components/Sheet";
import { type Theme, tokens, useTheme } from "../../theme";
import ReminderRow from "./ReminderRow";

// A delivered reminder's menu, opened by a long press on its row
// (ReminderRow): the row drawn once more as a card over a sheet (Sheet)
// with Copy text, which puts the text on the clipboard exactly as typed,
// and Delete where the screen gives it (onDelete: the person who set it,
// and a moderator in a space, core/reminders mayDeleteReminder), which
// asks first, in web's words. Nothing else: a reminder takes no
// reaction, reply, thread, quote, edit or pin.
export default function ReminderMenu({
  message,
  onDelete,
  onClose,
}: {
  message: Message;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  return (
    <Sheet
      label="Reminder actions"
      menu
      closeTestID="reminder-menu-close"
      card={<ReminderRow message={message} card />}
      onClose={onClose}
    >
      {({ dismiss, closing }) => (
        <>
          <Pressable
            accessibilityRole="menuitem"
            accessibilityLabel="Copy text"
            testID="reminder-menu-copy"
            onPress={() => {
              if (closing()) return;
              Clipboard.setStringAsync(message.content).catch(() => {});
              Haptics.selectionAsync().catch(() => {});
              dismiss();
            }}
            style={({ pressed }) => [styles.item, pressed && styles.pressed]}
          >
            <CopyIcon color={theme.textMuted} />
            <Text style={styles.label}>Copy text</Text>
          </Pressable>
          {onDelete && (
            <Pressable
              accessibilityRole="menuitem"
              accessibilityLabel="Delete"
              testID="reminder-menu-delete"
              onPress={() => {
                if (closing()) return;
                Alert.alert("Delete this reminder?", "It's removed for everyone.", [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: () => {
                      onDelete();
                      dismiss();
                    },
                  },
                ]);
              }}
              style={({ pressed }) => [styles.item, pressed && styles.pressed]}
            >
              <TrashIcon color={theme.danger} />
              <Text style={[styles.label, styles.danger]}>Delete</Text>
            </Pressable>
          )}
        </>
      )}
    </Sheet>
  );
}

// As the message menu's items.
function makeStyles(theme: Theme) {
  return StyleSheet.create({
    item: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      minHeight: 52,
      paddingHorizontal: 12,
      borderRadius: tokens.radiusMd,
    },
    pressed: {
      backgroundColor: theme.hover,
    },
    label: {
      flex: 1,
      color: theme.text,
      fontSize: 16,
    },
    danger: {
      color: theme.danger,
    },
  });
}
