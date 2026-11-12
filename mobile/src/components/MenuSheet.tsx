import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { type Theme, tokens, useTheme } from "../theme";
import Sheet from "./Sheet";

// The menu a long press on a row opens (a conversation's, a channel's):
// the row drawn once more as a card, and a sheet (Sheet) of items under
// it. Picking an item runs it and closes the sheet; a disabled one is
// drawn dimmed, takes no press and is announced as disabled. A tap on
// the scrim, a swipe down or Android's back closes it with nothing.

export type MenuSheetItem = {
  label: string;
  icon: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
};

export default function MenuSheet({
  label,
  closeTestID,
  card,
  items,
  onClose,
}: {
  // What a screen reader calls the sheet.
  label: string;
  // The scrim's, for the flows.
  closeTestID: string;
  card: ReactNode;
  items: MenuSheetItem[];
  onClose: () => void;
}) {
  const styles = makeStyles(useTheme());

  return (
    <Sheet label={label} menu closeTestID={closeTestID} card={card} onClose={onClose}>
      {({ dismiss, closing }) =>
        items.map((item) => (
          <Pressable
            key={item.label}
            accessibilityRole="menuitem"
            accessibilityLabel={item.label}
            disabled={item.disabled}
            onPress={() => {
              if (closing()) return;
              item.onPress?.();
              dismiss();
            }}
            style={({ pressed }) => [styles.item, item.disabled && styles.disabled, pressed && styles.pressed]}
          >
            {item.icon}
            <Text style={styles.label}>{item.label}</Text>
          </Pressable>
        ))
      }
    </Sheet>
  );
}

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
    disabled: {
      opacity: tokens.disabled,
    },
    pressed: {
      backgroundColor: theme.hover,
    },
    label: {
      flex: 1,
      color: theme.text,
      fontSize: 16,
    },
  });
}
