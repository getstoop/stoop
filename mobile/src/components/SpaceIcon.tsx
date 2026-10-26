import { Image } from "expo-image";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { fileSource } from "../api/files";
import { type Theme, tokens, useTheme } from "../theme";

// A space's icon, fetched with the session as a bearer token (the server
// takes it on /files as on every RPC; expo-image, whose cache sign-out
// clears), or its first letter when it has none or the icon won't load.
export default function SpaceIcon({
  name,
  fileId,
  origin,
  token,
  size,
}: {
  name: string;
  fileId: string;
  origin: string;
  token: string;
  size: number;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme, size);
  const [failed, setFailed] = useState(false);
  if (fileId && !failed) {
    return (
      <Image
        source={fileSource(origin, token, fileId)}
        style={styles.icon}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <View style={styles.icon}>
      <Text style={styles.letter}>{name.trim().charAt(0).toUpperCase()}</Text>
    </View>
  );
}

function makeStyles(theme: Theme, size: number) {
  return StyleSheet.create({
    icon: {
      width: size,
      height: size,
      borderRadius: tokens.radiusLg,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.accentSoft,
      overflow: "hidden",
    },
    letter: {
      color: theme.accent,
      fontSize: size >= 48 ? tokens.textXl : tokens.textLg,
      fontWeight: "700",
    },
  });
}
