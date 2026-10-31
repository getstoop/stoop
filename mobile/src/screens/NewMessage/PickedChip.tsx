import { personName } from "@stoop/core/dms";
import type { MessageAuthor } from "@stoop/gen/stoop/chat/v1/message_pb";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { CloseIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";

// Someone picked, in the To line: their name and a cross that puts them
// back.
export default function PickedChip({
  person,
  onRemove,
}: {
  person: MessageAuthor;
  onRemove: (person: MessageAuthor) => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const name = personName(person);
  return (
    <View style={styles.chip}>
      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${name}`}
        hitSlop={10}
        onPress={() => onRemove(person)}
        style={styles.remove}
      >
        <CloseIcon color={theme.text} size={14} />
      </Pressable>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      height: 32,
      maxWidth: "100%",
      paddingLeft: 12,
      paddingRight: 6,
      borderRadius: tokens.radiusPill,
      backgroundColor: theme.accentSoft,
    },
    name: {
      flexShrink: 1,
      color: theme.text,
      fontSize: tokens.textUi,
      fontWeight: "600",
    },
    remove: {
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
    },
  });
}
