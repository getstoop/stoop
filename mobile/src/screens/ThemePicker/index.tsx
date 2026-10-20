import { Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckIcon } from "../../components/Icons";
import {
  type Theme,
  type ThemeName,
  themeList,
  themes,
  tokens,
  useTheme,
  useThemeName,
} from "../../theme";

// Every web theme, filed as web's picker files them: light, dim, dark.
// A tap applies it at once, as on web: a wrong pick costs one more tap,
// so there is nothing to save. Each row's swatch is painted in its own
// theme's colours.

type Entry = (typeof themeList)[number];

const TIERS = [
  { tier: "light", title: "Light" },
  { tier: "dim", title: "Dim" },
  { tier: "dark", title: "Dark" },
] as const;

const SECTIONS = TIERS.map(({ tier, title }) => ({
  title,
  data: themeList.filter((t) => t.tier === tier) as Entry[],
}));

export default function ThemePicker() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(theme);
  const [current, setCurrent] = useThemeName();

  return (
    <SectionList
      style={styles.screen}
      contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 16 }]}
      sections={SECTIONS}
      keyExtractor={(t) => t.name}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        <Text style={styles.title} accessibilityRole="header">
          Theme
        </Text>
      }
      renderSectionHeader={({ section }) => (
        <Text style={styles.section} accessibilityRole="header">
          {section.title}
        </Text>
      )}
      renderItem={({ item }) => (
        <ThemeRow
          entry={item}
          selected={item.name === current}
          onPress={() => setCurrent(item.name as ThemeName)}
          styles={styles}
          checkColor={theme.accent}
        />
      )}
    />
  );
}

function ThemeRow({
  entry,
  selected,
  onPress,
  styles,
  checkColor,
}: {
  entry: Entry;
  selected: boolean;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  checkColor: string;
}) {
  const own = themes[entry.name as ThemeName];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${entry.label}. ${entry.blurb}`}
      testID={`theme-${entry.name}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, selected && styles.selected, pressed && styles.pressed]}
    >
      <View style={[styles.swatch, { backgroundColor: own.surface, borderColor: own.border }]}>
        <View style={[styles.swatchLine, { backgroundColor: own.text }]} />
        <View style={[styles.swatchDot, { backgroundColor: own.accent }]} />
      </View>
      <View style={styles.text}>
        <Text style={styles.name}>{entry.label}</Text>
        <Text style={styles.blurb} numberOfLines={2}>
          {entry.blurb}
        </Text>
      </View>
      {selected && <CheckIcon color={checkColor} />}
    </Pressable>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.surface,
    },
    list: {
      paddingHorizontal: 8,
    },
    title: {
      marginTop: 8,
      marginBottom: 4,
      marginHorizontal: 16,
      color: theme.text,
      fontSize: tokens.textXl,
      lineHeight: tokens.textXl * tokens.leadingTight,
      fontWeight: "700",
    },
    section: {
      marginTop: 20,
      marginBottom: 6,
      marginHorizontal: 16,
      color: theme.textMuted,
      fontSize: tokens.textXs,
      fontWeight: "600",
      letterSpacing: 0.6,
      textTransform: "uppercase",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 64,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: tokens.radiusMd,
    },
    selected: {
      backgroundColor: theme.raised,
    },
    pressed: {
      opacity: 0.85,
    },
    swatch: {
      width: 44,
      height: 44,
      borderRadius: tokens.radiusMd,
      borderWidth: 1,
      padding: 8,
      justifyContent: "space-between",
    },
    swatchLine: {
      width: 22,
      height: 4,
      borderRadius: 2,
    },
    swatchDot: {
      alignSelf: "flex-end",
      width: 12,
      height: 12,
      borderRadius: 6,
    },
    text: {
      flex: 1,
      gap: 2,
    },
    name: {
      color: theme.text,
      fontSize: tokens.textBody,
      fontWeight: "600",
    },
    blurb: {
      color: theme.textMuted,
      fontSize: tokens.textUi,
      lineHeight: tokens.textUi * tokens.leadingUi,
    },
  });
}
