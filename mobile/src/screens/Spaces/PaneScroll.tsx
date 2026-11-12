import type { ReactNode } from "react";
import { RefreshControl, ScrollView, StyleSheet } from "react-native";
import { useTheme } from "../../theme";
import { useBottomObstruction } from "./useBottomObstruction";

// What scrolls in the pane: a space's channels, or what stands in for
// them (the server unreachable, no spaces here), each of which a pull
// reloads. Its content is padded by what lies over the bottom of the
// screen (the tab bar on iOS), and its scroll bar stops there, so the
// last row always comes clear, however the scroll got there.
export default function PaneScroll({
  refreshing,
  onRefresh,
  children,
}: {
  refreshing: boolean;
  onRefresh: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const obstruction = useBottomObstruction();
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingBottom: PANE_PADDING + obstruction }]}
      // The padding above is the whole inset: the system adds none.
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustsScrollIndicatorInsets={false}
      scrollIndicatorInsets={{ bottom: obstruction }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.textMuted} />}
    >
      {children}
    </ScrollView>
  );
}

const PANE_PADDING = 24;

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    paddingTop: 4,
    paddingHorizontal: 8,
  },
});
