import { useState } from "react";
import { Image, type StyleProp, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { type Theme, useTheme } from "../theme";

// A person's avatar, fetched with the session as a bearer token, or their
// initials when they have none or it won't load. Decorative: the name
// beside it says who.
export default function Avatar({
  name,
  fileId,
  origin,
  token,
  size,
  style,
}: {
  name: string;
  fileId: string;
  origin: string;
  token: string;
  size: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme, size);
  const [failed, setFailed] = useState(false);

  return (
    <View style={[styles.avatar, style]} accessibilityElementsHidden importantForAccessibility="no">
      {fileId && !failed ? (
        <Image
          source={{ uri: `${origin}/files/${fileId}`, headers: { Authorization: `Bearer ${token}` } }}
          style={styles.image}
          onError={() => setFailed(true)}
        />
      ) : (
        <Text style={styles.initials}>{initials(name)}</Text>
      )}
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

function makeStyles(theme: Theme, size: number) {
  return StyleSheet.create({
    avatar: {
      width: size,
      height: size,
      borderRadius: size / 2,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.raised,
      overflow: "hidden",
    },
    image: {
      width: "100%",
      height: "100%",
    },
    initials: {
      color: theme.text,
      fontSize: Math.round(size * 0.37),
      fontWeight: "700",
    },
  });
}
