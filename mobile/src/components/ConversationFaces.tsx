import { personName } from "@stoop/core/dms";
import type { MessageAuthor } from "@stoop/gen/stoop/chat/v1/message_pb";
import { StyleSheet, View } from "react-native";
import type { Presence } from "../realtime/presence";
import { useTheme } from "../theme";
import Avatar from "./Avatar";
import PresenceDot from "./PresenceDot";

// A conversation's face: the other person's avatar, or a group's first
// two, overlapped corner to corner in the same square (core dmFaces).
// The other person's presence, when given, sits on their corner. Rimmed
// in `cutout`, the colour behind it (the list's, by default), so a
// group's two read as two and the dot as cut out of the face.
export default function ConversationFaces({
  faces,
  presence,
  origin,
  token,
  size = 44,
  cutout,
}: {
  faces: MessageAuthor[];
  presence?: Presence;
  origin: string;
  token: string;
  size?: number;
  cutout?: string;
}) {
  const theme = useTheme();
  const rim = cutout ?? theme.surface;
  const small = Math.round((size * 30) / 44);
  const styles = makeStyles(size, rim);
  const [first, second] = faces;
  if (!second) {
    return (
      <View style={styles.square}>
        <Avatar
          name={personName(first)}
          fileId={first?.avatarFileId ?? ""}
          origin={origin}
          token={token}
          size={size}
        />
        <PresenceDot presence={presence} cutout={rim} />
      </View>
    );
  }
  return (
    <View style={styles.square} accessibilityElementsHidden importantForAccessibility="no">
      <Avatar name={personName(first)} fileId={first.avatarFileId} origin={origin} token={token} size={small} />
      <Avatar
        name={personName(second)}
        fileId={second.avatarFileId}
        origin={origin}
        token={token}
        size={small}
        style={styles.second}
      />
    </View>
  );
}

function makeStyles(size: number, rim: string) {
  return StyleSheet.create({
    square: {
      width: size,
      height: size,
    },
    second: {
      position: "absolute",
      right: 0,
      bottom: 0,
      borderWidth: 2,
      borderColor: rim,
    },
  });
}
