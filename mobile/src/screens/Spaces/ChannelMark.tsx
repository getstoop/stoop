import { type Channel, ChannelKind, ChannelPostPolicy } from "@stoop/gen/stoop/chat/v1/channel_pb";
import { StyleSheet, Text, View } from "react-native";
import { LockIcon, MegaphoneIcon, SpeakerIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";

// What a channel is, before its name: a speaker for a voice room and,
// as on web, a lock for a private channel, a megaphone for an
// announcement channel and # for any other.
export default function ChannelMark({ channel }: { channel: Channel }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  return (
    <View style={styles.mark}>
      {channel.kind === ChannelKind.VOICE ? (
        <SpeakerIcon color={theme.textMuted} size={20} />
      ) : channel.private ? (
        <LockIcon color={theme.textMuted} />
      ) : channel.postPolicy === ChannelPostPolicy.ADMINS ? (
        <MegaphoneIcon color={theme.textMuted} />
      ) : (
        <Text style={styles.hash}>#</Text>
      )}
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    mark: {
      width: 20,
      alignItems: "center",
    },
    hash: {
      color: theme.textMuted,
      fontSize: tokens.textLg,
    },
  });
}
