import { Pressable, StyleSheet } from "react-native";
import { SearchIcon } from "../../components/Icons";
import { tokens, useTheme } from "../../theme";
import Surface from "./Surface";
import { type SearchProps, searchLabel } from "./searchItem";

// The channel header's Search where it isn't a bar button item
// (searchItem): a round bubble of the composer's panel surface, as the
// jump to the latest message is drawn, with the magnifier in it.
export default function SearchButton({ spaceName, onPress }: SearchProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={searchLabel(spaceName)}
      onPress={onPress}
      style={({ pressed }) => pressed && styles.down}
    >
      <Surface glass={false} style={styles.round}>
        <SearchIcon color={theme.text} size={22} />
      </Surface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  round: {
    width: 44,
    height: 44,
    borderRadius: tokens.radiusPill,
    alignItems: "center",
    justifyContent: "center",
  },
  down: {
    opacity: 0.85,
  },
});
