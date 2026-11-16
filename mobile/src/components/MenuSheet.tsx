import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { type Theme, tokens, useTheme } from "../theme";
import { CheckIcon } from "./Icons";
import Sheet from "./Sheet";

// The menu a long press on a row opens (a conversation's, a channel's):
// the row drawn once more as a card, and a sheet (Sheet) of items under
// it. Picking an item runs it and closes the sheet; a disabled one is
// drawn dimmed, takes no press and is announced as disabled. A tap on
// the scrim, a swipe down or Android's back closes it with nothing.
// It is also the sheet of a choice among a few (a call's outputs): no
// card, and the item that is the choice now checked and announced as
// selected.

export type MenuSheetItem = {
  label: string;
  icon: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  // In a list to choose one of: whether this is the one chosen now.
  selected?: boolean;
  // For the flows.
  testID?: string;
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
  card?: ReactNode;
  items: MenuSheetItem[];
  onClose: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);

  return (
    <Sheet label={label} menu closeTestID={closeTestID} card={card} onClose={onClose}>
      {({ dismiss, closing }) =>
        items.map((item) => (
          <Pressable
            key={item.label}
            accessibilityRole="menuitem"
            accessibilityLabel={item.label}
            accessibilityState={item.selected === undefined ? undefined : { selected: item.selected }}
            disabled={item.disabled}
            testID={item.testID}
            onPress={() => {
              if (closing()) return;
              item.onPress?.();
              dismiss();
            }}
            style={({ pressed }) => [styles.item, item.disabled && styles.disabled, pressed && styles.pressed]}
          >
            {item.icon}
            <Text style={styles.label}>{item.label}</Text>
            {item.selected && <CheckIcon color={theme.accent} size={20} />}
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
