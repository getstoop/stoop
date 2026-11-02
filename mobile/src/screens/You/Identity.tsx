import type { User } from "@stoop/gen/stoop/auth/v1/auth_pb";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Avatar from "../../components/Avatar";
import type { SavedServer } from "../../servers";
import { type Theme, tokens, useTheme } from "../../theme";

// Who you are on this server: your avatar, your name, and your handle
// and pronouns with the server's name, and the way to change them.
export default function Identity({
  user,
  server,
  token,
  onEdit,
}: {
  user: User;
  server: SavedServer;
  token: string;
  onEdit: () => void;
}) {
  const styles = makeStyles(useTheme());
  const name = user.displayName || user.username;
  const line = [`@${user.username}`, user.pronouns, `on ${server.name}`].filter(Boolean).join(" · ");

  return (
    <View style={styles.identity}>
      <Avatar name={name} fileId={user.avatarFileId} origin={server.origin} token={token} size={60}
        label={user.avatarFileId ? "Your avatar" : "No avatar yet"} />
      <View style={styles.text}>
        <Text style={styles.name} accessibilityRole="header" numberOfLines={2}>
          {name}
        </Text>
        <Text style={styles.line}>{line}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Edit profile"
        testID="edit-profile"
        hitSlop={4}
        onPress={onEdit}
        style={({ pressed }) => [styles.edit, pressed && styles.pressed]}
      >
        <Text style={styles.editLabel}>Edit</Text>
      </Pressable>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    identity: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      paddingTop: 4,
      paddingHorizontal: 4,
    },
    text: {
      flex: 1,
      gap: 2,
    },
    name: {
      color: theme.text,
      fontSize: tokens.textXl,
      lineHeight: tokens.textXl * tokens.leadingTight,
      fontWeight: "700",
    },
    line: {
      color: theme.textMuted,
      fontSize: tokens.textUi,
    },
    edit: {
      height: 36,
      paddingHorizontal: 14,
      borderRadius: tokens.radiusMd,
      justifyContent: "center",
      backgroundColor: theme.raised,
    },
    pressed: {
      opacity: 0.7,
    },
    editLabel: {
      color: theme.text,
      fontSize: tokens.textUi,
      fontWeight: "600",
    },
  });
}
