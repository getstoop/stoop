import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Platform, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import SpaceIcon from "../../components/SpaceIcon";
import { type Theme, tokens, useTheme } from "../../theme";
import Surface from "../Channel/Surface";

// What the bar keeps for the back button at the left and the screen's
// inset at the right: on iOS the button's inset, its 44 and a gap, with a
// little to spare (a title wider than the bar's room for it is cut off);
// on Android the 56 the title starts at.
const BAR_KEPT = Platform.OS === "ios" ? 96 : 72;

// The header's title: the space's icon, its name, and how many are in it
// with what it is, in a pill beside the back button, as the channel's
// title is (TitlePill). It takes the rest of the row, so it is given its
// width: the bar hands a title only the room it asks for.
export default function SpaceTitle({
  name,
  about,
  iconFileId,
  origin,
  token,
}: {
  name: string;
  about: string;
  iconFileId: string;
  origin: string;
  token: string;
}) {
  const styles = makeStyles(useTheme());
  const { width } = useWindowDimensions();
  const glass = Platform.OS === "ios" && isLiquidGlassAvailable();
  return (
    <Surface glass={glass} style={{ ...styles.pill, width: width - BAR_KEPT }}>
      <View style={styles.row} accessible accessibilityRole="header" accessibilityLabel={`${name}, ${about}`}>
        <SpaceIcon name={name} fileId={iconFileId} origin={origin} token={token} size={32} />
        <View style={styles.lines}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.about} numberOfLines={1}>
            {about}
          </Text>
        </View>
      </View>
    </Surface>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    pill: {
      minHeight: 44,
      paddingLeft: 6,
      paddingRight: 16,
      paddingVertical: 4,
      borderRadius: tokens.radiusPill,
      justifyContent: "center",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    lines: {
      flex: 1,
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
