import { Pressable, StyleSheet, Text, View } from "react-native";
import { SearchIcon } from "../../components/Icons";
import SkeletonBlock from "../../components/SkeletonBlock";
import { type Theme, tokens, useTheme } from "../../theme";
import { searchLabel } from "../Channel/searchItem";

// The top of the pane: the space's name over how many are in it and
// what it is, and the button that searches it. The name is there as
// soon as a space is picked; the line under it comes with the space's
// channels, a placeholder holding its place until then.
export default function PaneHeader({
  name,
  about,
  onSearch,
}: {
  name: string;
  about: string | undefined;
  onSearch: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);

  return (
    <View style={styles.header}>
      <View
        style={styles.lines}
        accessible
        accessibilityRole="header"
        accessibilityLabel={about === undefined ? name : `${name}, ${about}`}
      >
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        {about === undefined ? (
          <View style={styles.pending}>
            <SkeletonBlock width="70%" height={tokens.textUi} />
          </View>
        ) : (
          <Text style={styles.about} numberOfLines={1}>
            {about}
          </Text>
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={searchLabel(name)}
        testID="space-search"
        onPress={onSearch}
        style={({ pressed }) => [styles.search, pressed && styles.pressed]}
      >
        <SearchIcon color={theme.textMuted} size={22} />
      </Pressable>
    </View>
  );
}

function makeStyles(theme: Theme) {
  const aboutHeight = tokens.textUi * tokens.leadingUi;
  return StyleSheet.create({
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingTop: 14,
      paddingRight: 8,
      paddingBottom: 8,
      paddingLeft: 20,
    },
    lines: {
      flex: 1,
      gap: 2,
    },
    name: {
      color: theme.text,
      fontSize: tokens.textXl,
      lineHeight: tokens.textXl * tokens.leadingTight,
      fontWeight: "700",
    },
    about: {
      color: theme.textMuted,
      fontSize: tokens.textUi,
      lineHeight: aboutHeight,
    },
    // The about line's height, so the header doesn't move when it lands.
    pending: {
      height: aboutHeight,
      justifyContent: "center",
    },
    search: {
      width: 44,
      height: 44,
      borderRadius: tokens.radiusPill,
      alignItems: "center",
      justifyContent: "center",
    },
    pressed: {
      backgroundColor: theme.hover,
    },
  });
}
