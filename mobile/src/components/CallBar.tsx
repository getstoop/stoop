import { StyleSheet, View } from "react-native";
import { type Theme, useTheme } from "../theme";
import CallBarContent from "./CallBarContent";

// The call bar as a row docked on the tab bar, where the server chip's
// row is with no call (hooks/useServerChipRoom.ts says which of the two
// shows). `lined` off is the row at the top of Android's tab bar, whose
// rounded top draws the line itself ((tabs)/_layout.tsx).
export default function CallBar({ lined = true }: { lined?: boolean }) {
  const styles = makeStyles(useTheme());
  return (
    <View style={[styles.docked, lined && styles.lined]}>
      <CallBarContent />
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    docked: {
      backgroundColor: theme.panel,
    },
    lined: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border,
    },
  });
}
