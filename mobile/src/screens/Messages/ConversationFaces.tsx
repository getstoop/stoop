import { personName } from "@stoop/core/dms";
import type { MessageAuthor } from "@stoop/gen/stoop/chat/v1/message_pb";
import { StyleSheet, View } from "react-native";
import Avatar from "../../components/Avatar";
import { type Theme, useTheme } from "../../theme";

const SIZE = 44;
const SMALL = 30;

// A conversation's face: the other person's avatar, or a group's first
// two, overlapped corner to corner in the same square (core dmFaces).
export default function ConversationFaces({
  faces,
  origin,
  token,
}: {
  faces: MessageAuthor[];
  origin: string;
  token: string;
}) {
  const styles = makeStyles(useTheme());
  const [first, second] = faces;
  if (!second) {
    return (
      <Avatar
        name={personName(first)}
        fileId={first?.avatarFileId ?? ""}
        origin={origin}
        token={token}
        size={SIZE}
      />
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
