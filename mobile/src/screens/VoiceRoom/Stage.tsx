import { ScrollView, StyleSheet, Text, useWindowDimensions } from "react-native";
import { type Theme, tokens, useTheme } from "../../theme";
import { type StagePerson, stageLayout } from "./stageRules";
import Tile from "./Tile";

const SIDE = 16;
const GAP = 12;

// The Stage: a tile for everyone in the room, one or two stacked full
// width, more in two columns (stageRules), scrolling under the floating
// header and the foot, which `top` and `bottom` clear. An empty room
// says so; while the roster isn't known (the socket not connected)
// there is nothing to say.
export default function Stage({
  people,
  origin,
  token,
  top,
  bottom,
}: {
  people: StagePerson[] | undefined;
  origin: string;
  token: string;
  top: number;
  bottom: number;
}) {
  const styles = makeStyles(useTheme());
  const { width } = useWindowDimensions();
  const { columns, size } = stageLayout(people?.length ?? 0);
  const tileWidth = Math.floor((width - 2 * SIDE - (columns - 1) * GAP) / columns);
  return (
    <ScrollView
      style={styles.stage}
      contentContainerStyle={[styles.tiles, { paddingTop: top + GAP, paddingBottom: bottom + SIDE }]}
      // The padding above is the whole inset: the system adds none.
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustsScrollIndicatorInsets={false}
      scrollIndicatorInsets={{ top, bottom }}
    >
      {people?.length === 0 && <Text style={styles.empty}>Nobody's here yet</Text>}
      {people?.map((person) => (
        <Tile key={person.userId} person={person} size={size} width={tileWidth} origin={origin} token={token} />
      ))}
    </ScrollView>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    stage: {
      flex: 1,
    },
    tiles: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: GAP,
      paddingHorizontal: SIDE,
    },
    empty: {
      width: "100%",
      marginTop: 120,
      textAlign: "center",
      color: theme.textMuted,
      fontSize: tokens.textBody,
      lineHeight: tokens.textBody * tokens.leadingBody,
    },
  });
}
