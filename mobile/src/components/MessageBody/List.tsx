import { Text, View } from "react-native";
import { markdown } from "../../theme";
import { type ListRow, rowIndent, spokenMarker } from "./blocks";
import type { BodyContext } from "./context";
import Paragraph from "./Paragraph";
import type { Styles } from "./styles";

// The browser's space after a marker; no-break, so it isn't trimmed.
const NBSP = "\u00a0";

// A list, as web's nested lists: each row indented by its depth, its
// bullet or number in the indent against its words. The marker is
// drawn, not read: the row's paragraph says it before its words.
export default function List({ rows, styles, body }: { rows: ListRow[]; styles: Styles; body: BodyContext }) {
  return (
    <View>
      {rows.map((row) => {
        const indent = rowIndent(row.depth);
        return (
          <View key={row.lines[0].path} style={{ paddingLeft: indent }}>
            <Text
              style={[styles.marker, { left: indent - markdown.listIndent }]}
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {row.marker}
              {NBSP}
            </Text>
            <Paragraph lines={row.lines} indent={indent} prefix={spokenMarker(row)} body={body} />
          </View>
        );
      })}
    </View>
  );
}
