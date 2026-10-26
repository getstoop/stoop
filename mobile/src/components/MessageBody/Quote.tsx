import { View } from "react-native";
import { QUOTE_INDENT } from "./blocks";
import type { BodyContext } from "./context";
import type { Line } from "./lines";
import Paragraph from "./Paragraph";
import type { Styles } from "./styles";

// A quote, as web's blockquote: the bar at its left and its words muted,
// each mark, pill and spoiler drawn as anywhere else.
export default function Quote({ lines, styles, body }: { lines: Line[]; styles: Styles; body: BodyContext }) {
  return (
    <View style={styles.quote}>
      {lines.length > 0 && <Paragraph lines={lines} indent={QUOTE_INDENT} muted body={body} />}
    </View>
  );
}
