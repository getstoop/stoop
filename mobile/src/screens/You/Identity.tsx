import type { User } from "@stoop/gen/stoop/auth/v1/auth_pb";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Avatar from "../../components/Avatar";
import { PencilIcon } from "../../components/Icons";
import type { SavedServer } from "../../servers";
import { type Theme, tokens, useTheme } from "../../theme";

// Who you are on this server: your avatar, your name, and your handle
// and pronouns with the server's name, and the pencil that changes them.
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
  const theme = useTheme();
  const styles = makeStyles(theme);
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
        hitSlop={2}
        onPress={onEdit}
        style={({ pressed }) => [styles.edit, pressed && styles.pressed]}
      >
        <PencilIcon color={theme.text} size={22} />
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
      width: 44,
      height: 44,
      borderRadius: tokens.radiusMd,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.raised,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
