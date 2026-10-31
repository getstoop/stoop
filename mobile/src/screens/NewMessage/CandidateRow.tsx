import { personName } from "@stoop/core/dms";
import type { MessageAuthor } from "@stoop/gen/stoop/chat/v1/message_pb";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Avatar from "../../components/Avatar";
import { CheckIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";

// One person New message may add: their face, name and handle, and a
// round check at the end, filled while they are picked. A press picks
// them or puts them back. Once the conversation is full, everyone not
// picked is dimmed and can't be pressed.
export default memo(function CandidateRow({
  person,
  picked,
  full,
  origin,
  token,
  onToggle,
}: {
  person: MessageAuthor;
  picked: boolean;
  full: boolean;
  origin: string;
  token: string;
  onToggle: (person: MessageAuthor) => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const name = personName(person);
  const off = full && !picked;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={`${name}, @${person.username}`}
      accessibilityState={{ checked: picked, disabled: off }}
      disabled={off}
      testID={`candidate-${person.username}`}
      onPress={() => onToggle(person)}
      style={({ pressed }) => [styles.row, off && styles.off, pressed && styles.pressed]}
    >
      <Avatar name={name} fileId={person.avatarFileId} origin={origin} token={token} size={40} />
      <View style={styles.who}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.handle} numberOfLines={1}>
          @{person.username}
        </Text>
      </View>
      <View style={[styles.mark, picked ? styles.on : styles.unpicked]}>
        {picked && <CheckIcon color={theme.onAccent} size={14} />}
      </View>
    </Pressable>
  );
});

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 60,
      paddingHorizontal: 12,
      borderRadius: tokens.radiusMd,
    },
    off: {
      opacity: 0.4,
    },
    pressed: {
      backgroundColor: theme.hover,
    },
    who: {
      flex: 1,
      minWidth: 0,
      gap: 1,
    },
    name: {
      color: theme.text,
      fontSize: tokens.textBody,
      fontWeight: "600",
    },
    handle: {
      color: theme.textMuted,
      fontSize: tokens.textSm,
    },
    mark: {
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    unpicked: {
      borderWidth: 2,
      borderColor: theme.border,
    },
    on: {
      backgroundColor: theme.accent,
    },
  });
}
