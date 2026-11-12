import { StyleSheet, View } from "react-native";
import SkeletonBlock from "../../components/SkeletonBlock";
import { tokens } from "../../theme";

const TILES = ["one", "two", "three", "four"];

// The rail before the spaces are in: a few tiles where their icons go.
export default function RailSkeleton() {
  return (
    <View style={styles.rail}>
      {TILES.map((tile) => (
        <View key={tile} style={styles.item}>
          <SkeletonBlock width={44} height={44} radius={tokens.radiusLg} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    width: tokens.railW,
    paddingTop: 8,
  },
  item: {
    width: tokens.railW,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
});
