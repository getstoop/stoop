import type { Channel } from "@stoop/gen/stoop/chat/v1/channel_pb";
import { StyleSheet, Text, View } from "react-native";
import { LockIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";
import TitlePill from "./TitlePill";

// The header's title, in its pill: a tall # at the left (a lock, as on
// the space's screen, for a private one), and beside it the channel's
// name over the space and how many people can read the channel.
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
      <View style={styles.row}>
        {channel.private ? <LockIcon color={theme.textMuted} size={24} /> : <Text style={styles.mark}>#</Text>}
        <View style={styles.lines}>
          <Text style={styles.name} numberOfLines={1}>
            {channel.name}
          </Text>
          <Text style={styles.about} numberOfLines={1}>
            {spaceName} · {people}
          </Text>
        </View>
      </View>
    </TitlePill>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    mark: {
      color: theme.textMuted,
      fontSize: 28,
      fontWeight: "700",
    },
    lines: {
      flexShrink: 1,
      gap: 1,
    },
    name: {
      color: theme.text,
      fontSize: 17,
      fontWeight: "700",
    },
    about: {
      color: theme.textMuted,
      fontSize: tokens.textSm,
    },
  });
}
