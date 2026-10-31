import type { Channel } from "@stoop/gen/stoop/chat/v1/channel_pb";
import { StyleSheet, Text, View } from "react-native";
import { LockIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";
import TitlePill from "../Channel/TitlePill";

// The thread screen's title, in the channel's pill: "Thread", and under
// it the channel (a lock for a private one, as the channel's own title
// has) and its space, once they are known; in a direct message, the
// conversation's title (`conversation`) instead.
export default function ThreadTitle({
  channel,
  spaceName,
  conversation,
}: {
  channel?: Channel;
  spaceName: string;
  conversation?: string;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const label = conversation
    ? `Thread, ${conversation}`
    : channel
      ? `Thread, ${channel.name}, ${spaceName}`
      : "Thread";
  return (
    <TitlePill label={label}>
      <Text style={styles.name}>Thread</Text>
      {conversation ? (
        <Text style={styles.about} numberOfLines={1}>
          {conversation}
        </Text>
      ) : (
        channel && (
        <View style={styles.line}>
          {channel.private && <LockIcon color={theme.textMuted} size={12} />}
          <Text style={styles.about} numberOfLines={1}>
            {channel.private ? "" : "#"}
            {channel.name} · {spaceName}
          </Text>
        </View>
        )
      )}
    </TitlePill>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
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
