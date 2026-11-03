import { Image } from "expo-image";
import { useState } from "react";
import { type StyleProp, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { fileSource } from "../api/files";
import { type Theme, tokens, useTheme } from "../theme";

// A person's avatar, a rounded square: their picture, fetched with the
// session as a bearer token (expo-image, whose cache sign-out clears),
// or their initials when they have none or it won't load. Decorative,
// the name beside it saying who, unless given a label to be read out.
export default function Avatar({
  name,
  fileId,
  origin,
  token,
  size,
  style,
  label,
}: {
  name: string;
  fileId: string;
  origin: string;
  token: string;
  size: number;
  style?: StyleProp<ViewStyle>;
  label?: string;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme, size);
  // The picture that wouldn't load, so a new one gets its own chance.
  const [failed, setFailed] = useState("");
  const read = label
    ? ({ accessible: true, accessibilityRole: "image", accessibilityLabel: label } as const)
    : ({ accessibilityElementsHidden: true, importantForAccessibility: "no" } as const);

  return (
    <View style={[styles.avatar, style]} {...read}>
      {fileId && failed !== fileId ? (
        <Image
          source={fileSource(origin, token, fileId)}
          style={styles.image}
          onError={() => setFailed(fileId)}
        />
      ) : (
        <Text style={styles.initials}>{initials(name)}</Text>
      )}
    </View>
  );
}

// The corner of every user avatar, and of anything drawn in one's place
// (a mention list's # or @ mark): the radius web (#668, controls.css)
// gives the nearest of its three sizes, 24px → 6, 40px → 8, 64px → 12,
// about a quarter of the side. The one place the shape is decided.
export function avatarRadius(size: number): number {
  if (size < 32) return tokens.radius;
  if (size < 52) return tokens.radiusMd;
  return tokens.radiusLg;
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
      borderRadius: avatarRadius(size),
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
