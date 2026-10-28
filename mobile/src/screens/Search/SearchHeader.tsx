import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BackIcon, CloseIcon, SearchIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";
import Surface from "../Channel/Surface";

// The search screen's header, floating over the list under the status
// bar as the channel's does: a round back button and the field's pill,
// both the composer's surface (Liquid Glass where iOS has it, else the
// panel). The pill holds the magnifier, the field and, while there are
// words in it, a small round clear. The return key runs the search.
export default function SearchHeader({
  spaceName,
  draft,
  autoFocus,
  onChange,
  onSubmit,
  onBack,
  onLayout,
}: {
  spaceName: string;
  draft: string;
  autoFocus: boolean;
  onChange: (text: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  // The header's height as drawn, for the list to clear.
  onLayout: (height: number) => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const glass = Platform.OS === "ios" && isLiquidGlassAvailable();
  return (
    <View
      style={[styles.header, { paddingTop: insets.top + 6 }]}
      // Only the button and the pill take touches: the list scrolls
      // under the rest of the row.
      pointerEvents="box-none"
      onLayout={(event) => onLayout(event.nativeEvent.layout.height)}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={onBack}
        style={({ pressed }) => pressed && styles.down}
      >
        <Surface glass={glass} style={styles.round}>
          <BackIcon color={theme.text} size={24} />
        </Surface>
      </Pressable>
      <Surface glass={glass} style={styles.pill}>
        <SearchIcon color={theme.textMuted} size={18} />
        <TextInput
          value={draft}
          onChangeText={onChange}
          onSubmitEditing={onSubmit}
          placeholder="Words, “a phrase”, from:@name"
          placeholderTextColor={theme.textMuted}
          accessibilityLabel={`Search messages in ${spaceName}`}
          testID="search-field"
          autoFocus={autoFocus}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={styles.field}
        />
        {draft !== "" && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear"
            onPress={() => onChange("")}
            style={({ pressed }) => [styles.clear, pressed && styles.down]}
          >
            <CloseIcon color={theme.textMuted} size={14} />
          </Pressable>
        )}
      </Surface>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    header: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 16,
      paddingBottom: 8,
    },
    round: {
      width: 44,
      height: 44,
      borderRadius: tokens.radiusPill,
      alignItems: "center",
      justifyContent: "center",
    },
    pill: {
      flexGrow: 1,
      flexShrink: 1,
      height: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingLeft: 14,
      paddingRight: 6,
      borderRadius: tokens.radiusPill,
    },
    field: {
      flex: 1,
      height: 44,
      paddingVertical: 0,
      color: theme.text,
      fontSize: tokens.textBody,
    },
    clear: {
      width: 32,
      height: 32,
      borderRadius: tokens.radiusPill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.raised,
    },
    down: {
      opacity: 0.85,
    },
  });
}
