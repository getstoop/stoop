import type { Channel } from "@stoop/gen/stoop/chat/v1/channel_pb";
import { StyleSheet, Text, View } from "react-native";
import { LockIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";

// The thread screen's title: "Thread", and under it the channel (a lock
// for a private one, as the channel's own title has) and its space, once
// they are known.
export default function ThreadTitle({ channel, spaceName }: { channel?: Channel; spaceName: string }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  return (
    <View
      style={styles.title}
      accessible
      accessibilityRole="header"
      accessibilityLabel={channel ? `Thread, ${channel.name}, ${spaceName}` : "Thread"}
    >
      <Text style={styles.name}>Thread</Text>
      {channel && (
        <View style={styles.line}>
          {channel.private && <LockIcon color={theme.textMuted} size={12} />}
          <Text style={styles.about} numberOfLines={1}>
            {channel.private ? "" : "#"}
            {channel.name} · {spaceName}
          </Text>
        </View>
      )}
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    title: {
      gap: 1,
    },
    line: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
    },
    name: {
      color: theme.text,
      fontSize: 17,
      fontWeight: "700",
    },
    about: {
      flexShrink: 1,
      color: theme.textMuted,
      fontSize: tokens.textSm,
    },
  });
}
