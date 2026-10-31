import { presenceClass } from "@stoop/core/presence";
import { StyleSheet, View } from "react-native";
import type { Presence } from "../realtime/presence";
import { type Theme, useTheme } from "../theme";

const SIZE = 12;

// Someone's presence on the corner of their avatar, in web's four shapes
// (web/src/styles/presence.css), so the states read with colour removed:
// a filled dot online, an empty ring offline, a dot with a bar through it
// on do not disturb, and a small phone for someone online only in a
// mobile app. The rim is drawn in `cutout`, the colour behind the avatar,
// so it reads as cut out of it. Nothing while presence isn't known. It
// says nothing to a screen reader: the row or title it sits in says it
// with core presenceLabel.
export default function PresenceDot({ presence, cutout }: { presence: Presence | undefined; cutout: string }) {
  const styles = makeStyles(useTheme(), cutout);
  if (!presence) return null;
  const shape = presenceClass(presence.online, presence.dnd, presence.mobile);
  return (
    <View
      style={[styles.dot, styles[shape]]}
      accessibilityElementsHidden
      importantForAccessibility="no"
      testID={`presence-${shape}`}
    >
      {shape === "offline" && <View style={styles.ring} />}
      {shape === "dnd" && <View style={styles.bar} />}
      {shape === "mobile" && <View style={styles.screen} />}
    </View>
  );
}

function makeStyles(theme: Theme, cutout: string) {
  return StyleSheet.create({
    dot: {
      position: "absolute",
      right: -2,
      bottom: -2,
      width: SIZE,
      height: SIZE,
      borderRadius: SIZE / 2,
      borderWidth: 2,
      borderColor: cutout,
      alignItems: "center",
      justifyContent: "center",
    },
    online: {
      backgroundColor: theme.ok,
    },
    offline: {
      backgroundColor: cutout,
    },
    // The ring inside the rim, in the muted text colour.
    ring: {
      width: SIZE - 4,
      height: SIZE - 4,
      borderRadius: (SIZE - 4) / 2,
      borderWidth: 2,
      borderColor: theme.textMuted,
    },
    dnd: {
      backgroundColor: theme.danger,
    },
    bar: {
      width: 6,
      height: 2,
      borderRadius: 1,
      backgroundColor: cutout,
    },
    // Taller than the dot and squared off, so it reads as a phone in a
    // scanned list.
    mobile: {
      right: -3,
      bottom: -4,
      width: 12,
      height: 17,
      borderRadius: 3,
      backgroundColor: theme.ok,
      justifyContent: "flex-start",
      paddingTop: 2,
    },
    screen: {
      width: 4,
      height: 7,
      borderRadius: 1,
      backgroundColor: cutout,
    },
  });
}
