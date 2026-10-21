import { StyleSheet } from "react-native";
import Avatar from "../../components/Avatar";
import { type Theme, useTheme } from "../../theme";

export type Person = { userId: string; name: string; avatarFileId: string };

const SIZE = 24;

// One small face in a voice room's row, overlapping the one before it,
// with a ring in the row's colour to keep the faces apart.
export default function Face({
  person,
  origin,
  token,
  first,
}: {
  person: Person;
  origin: string;
  token: string;
  first: boolean;
}) {
  const styles = makeStyles(useTheme());
  return (
    <Avatar
      name={person.name}
      fileId={person.avatarFileId}
      origin={origin}
      token={token}
      size={SIZE}
      style={[styles.ring, !first && styles.overlap]}
    />
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    ring: {
      borderWidth: 2,
      borderColor: theme.surface,
    },
    overlap: {
      marginLeft: -6,
    },
  });
}
