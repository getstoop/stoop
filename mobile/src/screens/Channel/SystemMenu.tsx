import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import { Alert, Pressable, StyleSheet, Text } from "react-native";
import { TrashIcon } from "../../components/Icons";
import Sheet from "../../components/Sheet";
import { type Theme, tokens, useTheme } from "../../theme";
import SystemRow from "./SystemRow";

// A system message's menu, opened by a long press on its row by someone
// who may moderate messages (core/permissions canDeleteAnyMessage), and
// only by them: being the row's author grants nothing, so this is not
// the message menu, whose Delete is the author's too. The row drawn once
// more as a card over a sheet (Sheet) with Delete alone, which asks
// first, in the words web's confirm uses; the confirm's Delete hands the
// row to the screen (onDelete), which says when the server refuses it,
// and Cancel leaves the sheet open.

export default function SystemMenu({
  message,
  onDelete,
  onClose,
}: {
  message: Message;
  onDelete: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  return (
    <Sheet
      label="System message actions"
      menu
      closeTestID="system-menu-close"
      card={<SystemRow message={message} card />}
      onClose={onClose}
    >
      {({ dismiss, closing }) => (
        <Pressable
          accessibilityRole="menuitem"
          accessibilityLabel="Delete"
          testID="system-menu-delete"
          onPress={() => {
            if (closing()) return;
            Alert.alert("Delete this line from the channel?", "It's removed for everyone. What it records stays as it is.", [
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
          <Text style={styles.label}>Delete</Text>
        </Pressable>
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
      color: theme.danger,
      fontSize: 16,
    },
  });
}
