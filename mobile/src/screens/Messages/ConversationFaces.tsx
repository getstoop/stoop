import { personName } from "@stoop/core/dms";
import type { MessageAuthor } from "@stoop/gen/stoop/chat/v1/message_pb";
import { StyleSheet, View } from "react-native";
import Avatar from "../../components/Avatar";
import PresenceDot from "../../components/PresenceDot";
import type { Presence } from "../../realtime/presence";
import { type Theme, useTheme } from "../../theme";

const SIZE = 44;
const SMALL = 30;

// A conversation's face: the other person's avatar, or a group's first
// two, overlapped corner to corner in the same square (core dmFaces).
// The other person's presence, when given, sits on their corner.
export default function ConversationFaces({
  faces,
  presence,
  origin,
  token,
}: {
  faces: MessageAuthor[];
  presence?: Presence;
  origin: string;
  token: string;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [first, second] = faces;
  if (!second) {
    return (
      <View style={styles.one}>
        <Avatar
          name={personName(first)}
          fileId={first?.avatarFileId ?? ""}
          origin={origin}
          token={token}
          size={SIZE}
        />
        <PresenceDot presence={presence} cutout={theme.surface} />
      </View>
    );
  }
  return (
    <View style={styles.pair} accessibilityElementsHidden importantForAccessibility="no">
      <Avatar name={personName(first)} fileId={first.avatarFileId} origin={origin} token={token} size={SMALL} />
      <Avatar
        name={personName(second)}
        fileId={second.avatarFileId}
        origin={origin}
        token={token}
        size={SMALL}
        style={styles.second}
      />
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    one: {
      width: SIZE,
      height: SIZE,
    },
    pair: {
      width: SIZE,
      height: SIZE,
    },
    // Ringed in the list's colour, so the two read as two.
    second: {
      position: "absolute",
      right: 0,
      bottom: 0,
      borderWidth: 2,
      borderColor: theme.surface,
    },
  });
}
