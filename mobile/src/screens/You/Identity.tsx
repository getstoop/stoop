import type { User } from "@stoop/gen/stoop/auth/v1/auth_pb";
import { StyleSheet, Text, View } from "react-native";
import Avatar from "../../components/Avatar";
import type { SavedServer } from "../../servers";
import { type Theme, tokens, useTheme } from "../../theme";

// Who you are on this server: your avatar, your name, and your handle
// and pronouns with the server's name.
export default function Identity({ user, server, token }: { user: User; server: SavedServer; token: string }) {
  const styles = makeStyles(useTheme());
  const name = user.displayName || user.username;
  const line = [`@${user.username}`, user.pronouns, `on ${server.name}`].filter(Boolean).join(" · ");

  return (
    <View style={styles.identity}>
      <Avatar name={name} fileId={user.avatarFileId} origin={server.origin} token={token} size={60} />
      <View style={styles.text}>
        <Text style={styles.name} accessibilityRole="header" numberOfLines={2}>
          {name}
        </Text>
        <Text style={styles.line}>{line}</Text>
      </View>
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
  });
}
