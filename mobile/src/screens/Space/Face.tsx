import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { type Theme, tokens, useTheme } from "../../theme";

export type Person = { userId: string; name: string; avatarFileId: string };

const SIZE = 24;

// One small face in a voice room's row, overlapping the one before it:
// the person's avatar, fetched with the session as a bearer token, or
// their initials. Decorative: the names beside the faces say who.
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
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [failed, setFailed] = useState(false);
  const style = [styles.face, !first && styles.overlap];

  if (person.avatarFileId && !failed) {
    return (
      <Image
        source={{ uri: `${origin}/files/${person.avatarFileId}`, headers: { Authorization: `Bearer ${token}` } }}
        style={style}
        onError={() => setFailed(true)}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    );
  }
  return (
    <View style={style} accessibilityElementsHidden importantForAccessibility="no">
      <Text style={styles.initials}>{initials(person.name)}</Text>
    </View>
  );
}

// "Priya Shah" → "PS", "theo" → "T".
function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    face: {
      width: SIZE,
      height: SIZE,
      borderRadius: SIZE / 2,
      borderWidth: 2,
      borderColor: theme.surface,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.raised,
      overflow: "hidden",
    },
    overlap: {
      marginLeft: -6,
    },
    initials: {
      color: theme.text,
      fontSize: 9,
      fontWeight: "700",
    },
  });
}
