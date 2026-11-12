import { type DimensionValue, StyleSheet, View } from "react-native";
import SkeletonBlock from "../../components/SkeletonBlock";

const ROWS: DimensionValue[] = ["55%", "70%", "40%", "60%", "48%"];

// The pane while a space's channels load: a heading and rows where the
// channels go and, before the spaces themselves are in, the lines of
// the pane's header above them.
export default function PaneSkeleton({ header }: { header?: boolean }) {
  return (
    <View>
      {header && (
        <View style={styles.header}>
          <SkeletonBlock width="50%" height={22} />
          <SkeletonBlock width="75%" height={13} />
        </View>
      )}
      <View style={styles.list}>
        <View style={styles.section}>
          <SkeletonBlock width={96} height={11} />
        </View>
        {ROWS.map((width) => (
          <View key={String(width)} style={styles.row}>
            <SkeletonBlock width={20} height={20} />
            <SkeletonBlock width={width} height={15} />
          </View>
        ))}
      </View>
    </View>
  );
}

// As PaneHeader's and the channel list's own measures.
const styles = StyleSheet.create({
  header: {
    gap: 8,
    minHeight: 44,
    justifyContent: "center",
    marginTop: 14,
    marginBottom: 8,
    marginLeft: 20,
    marginRight: 8,
  },
  list: {
    paddingTop: 4,
    paddingHorizontal: 8,
  },
  section: {
    marginTop: 8,
    marginBottom: 4,
    marginHorizontal: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    height: 48,
    paddingHorizontal: 12,
  },
});
