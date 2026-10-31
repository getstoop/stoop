import { dmFaces, dmIsGroup, dmOther, dmTitle } from "@stoop/core/dms";
import { presenceLabel } from "@stoop/core/presence";
import type { DirectMessage } from "@stoop/gen/stoop/chat/v1/chat_pb";
import { StyleSheet, Text, View } from "react-native";
import ConversationFaces from "../../components/ConversationFaces";
import { usePresence } from "../../realtime/RealtimeProvider";
import { type Theme, tokens, useTheme } from "../../theme";
import TitlePill from "./TitlePill";

// A direct message's title, in the channel's pill: the other person's
// face with their presence, their name over their handle; or a group's
// first two faces, its title made from who is in it, over how many
// people it holds, as web's conversation header (DMTitle).
export default function ConversationTitle({
  dm,
  myUserId,
  serverId,
  origin,
  token,
}: {
  dm: DirectMessage;
  myUserId: string;
  serverId: string;
  origin: string;
  token: string;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const group = dmIsGroup(dm);
  const other = group ? undefined : dmOther(dm, myUserId);
  const presence = usePresence(serverId, other?.id);
  const title = dmTitle(dm, myUserId);
  const under = group ? `${dm.participants.length} people` : other ? `@${other.username}` : "";
  const status = presence && presenceLabel(presence.online, presence.dnd, presence.mobile);
  const label = [title, under, status].filter(Boolean).join(", ");
  return (
    <TitlePill label={label}>
      <View style={styles.row}>
        <ConversationFaces
          faces={dmFaces(dm, myUserId)}
          presence={presence}
          origin={origin}
          token={token}
          size={FACE}
          cutout={theme.panel}
        />
        <View style={styles.lines}>
          <Text style={styles.name} numberOfLines={1}>
            {title}
          </Text>
          {under !== "" && (
            <Text style={styles.about} numberOfLines={1}>
              {under}
            </Text>
          )}
        </View>
      </View>
    </TitlePill>
  );
}

// Inside the pill's 44 points, with its padding.
const FACE = 34;

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginLeft: -10,
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
