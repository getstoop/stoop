import type { Channel } from "@stoop/gen/stoop/chat/v1/channel_pb";
import { StyleSheet, Text, View } from "react-native";
import { LockIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";
import TitlePill from "./TitlePill";

// The header's title, in its pill: the channel's name with its # (a
// lock, as on the space's screen, for a private one), and under it the
// space and how many people can read the channel.
export default function ChannelTitle({
  channel,
  spaceName,
  memberCount,
}: {
  channel: Channel;
  spaceName: string;
  memberCount: number;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const people = memberCount === 1 ? "1 member" : `${memberCount} members`;
  return (
    <TitlePill label={`${channel.name}, ${spaceName}, ${people}`}>
      <View style={styles.line}>
        {channel.private ? <LockIcon color={theme.textMuted} /> : <Text style={[styles.name, styles.mark]}>#</Text>}
        <Text style={styles.name} numberOfLines={1}>
          {channel.name}
        </Text>
      </View>
      <Text style={styles.about} numberOfLines={1}>
        {spaceName} · {people}
      </Text>
    </TitlePill>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    line: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    name: {
      flexShrink: 1,
      color: theme.text,
      fontSize: 17,
      fontWeight: "700",
    },
    mark: {
      color: theme.textMuted,
    },
    about: {
      color: theme.textMuted,
      fontSize: tokens.textSm,
    },
  });
}
