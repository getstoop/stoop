import { StyleSheet, Text, View } from "react-native";
import Avatar from "../../components/Avatar";
import { MicOffIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";
import { type StagePerson, type TileSize, tileLabel } from "./stageRules";

// How tall a tile is, and its avatar, at each size.
const SIZES: Record<TileSize, { height: number; avatar: number }> = {
  tall: { height: 250, avatar: 112 },
  regular: { height: 200, avatar: 84 },
  small: { height: 150, avatar: 64 },
};

// The speaking ring's width.
const RING = 3;

// One person on the Stage: their avatar in the middle of the tile and
// their name in its lower left corner, with a muted microphone beside
// it for someone who has muted theirs. Read out as one thing. Whoever
// is speaking wears a ring around the whole tile, which only the call
// itself knows: nobody does until this phone is in it.
export default function Tile({
  person,
  speaking,
  size,
  width,
  origin,
  token,
}: {
  person: StagePerson;
  speaking: boolean;
  size: TileSize;
  width: number;
  origin: string;
  token: string;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { height, avatar } = SIZES[size];
  return (
    <View style={[styles.tile, { width, height }]} accessible accessibilityLabel={tileLabel(person)}>
      <Avatar name={person.name} fileId={person.avatarFileId} origin={origin} token={token} size={avatar} />
      <View style={styles.name}>
        <Text style={styles.words} numberOfLines={1}>
          {person.name}
        </Text>
        {person.muted && <MicOffIcon color={theme.danger} size={16} />}
      </View>
      {/* Drawn over the tile's own border, so its coming and going moves nothing. */}
      {speaking && <View style={styles.ring} pointerEvents="none" />}
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    tile: {
      alignItems: "center",
      justifyContent: "center",
      borderRadius: tokens.radiusLg,
      backgroundColor: theme.panel,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
    },
    ring: {
      position: "absolute",
      top: -StyleSheet.hairlineWidth,
      right: -StyleSheet.hairlineWidth,
      bottom: -StyleSheet.hairlineWidth,
      left: -StyleSheet.hairlineWidth,
      borderRadius: tokens.radiusLg,
      borderWidth: RING,
      borderColor: theme.ok,
    },
    name: {
      position: "absolute",
      left: 12,
      right: 12,
      bottom: 10,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    words: {
      flexShrink: 1,
      color: theme.text,
      fontSize: tokens.textBody,
      fontWeight: "600",
    },
  });
}
