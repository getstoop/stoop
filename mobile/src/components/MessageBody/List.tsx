import { Text, useWindowDimensions, View } from "react-native";
import { type ListRow, rowIndent, spokenMarker } from "./blocks";
import type { BodyContext } from "./context";
import Paragraph from "./Paragraph";
import type { Styles } from "./styles";

// The browser's space after a marker; no-break, so it isn't trimmed.
const NBSP = "\u00a0";

// A list, as web's nested lists: each row indented by its depth, its
// bullet or number against its words. The marker is drawn, not read: the
// row's paragraph says it before its words.
//
// As a browser's outside marker, it ends where the words start and is as
// wide as it needs, one line: "100." at a large text size spills left of
// the indent rather than wrapping. Its box reaches a window's width left
// of the words, room enough for any marker, and puts it at its right end.
export default function List({ rows, styles, body }: { rows: ListRow[]; styles: Styles; body: BodyContext }) {
  const room = useWindowDimensions().width;
  return (
    <View>
      {rows.map((row) => {
        const indent = rowIndent(row.depth);
        return (
          <View key={row.lines[0].path} style={{ paddingLeft: indent, marginTop: row.gap }}>
            <View
              style={[styles.markerBox, { left: indent - room, width: room }]}
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Text style={styles.marker} numberOfLines={1}>
                {row.marker}
                {NBSP}
              </Text>
            </View>
            <Paragraph lines={row.lines} indent={indent} prefix={spokenMarker(row)} body={body} />
          </View>
        );
      })}
    </View>
  );
}
