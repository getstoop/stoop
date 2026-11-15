import { StyleSheet, Text, View } from "react-native";
import Avatar, { avatarRadius } from "../../components/Avatar";
import { MicOffIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";
import { type StagePerson, type TileSize, tileLabel } from "./stageRules";

// How tall a tile is, and its avatar, at each size.
const SIZES: Record<TileSize, { height: number; avatar: number; gap: number }> = {
  tall: { height: 250, avatar: 112, gap: 14 },
  regular: { height: 200, avatar: 84, gap: 14 },
  small: { height: 150, avatar: 64, gap: 10 },
};

// The speaking ring's width, and its distance from the avatar.
const RING = 3;

// One person on the Stage: their avatar over their name, with a muted
// microphone beside it for someone who has muted theirs. Read out as
// one thing. Whoever is speaking wears a ring, which only the call
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
  const { height, avatar, gap } = SIZES[size];
  return (
    <View style={[styles.tile, { width, height, gap }]} accessible accessibilityLabel={tileLabel(person)}>
      {/* Always there, so the ring coming and going moves nothing. */}
      <View style={[styles.ring, { borderRadius: avatarRadius(avatar) + 2 * RING }, speaking && styles.speaking]}>
        <Avatar name={person.name} fileId={person.avatarFileId} origin={origin} token={token} size={avatar} />
      </View>
      <View style={styles.name}>
        <Text style={styles.words} numberOfLines={1}>
          {person.name}
        </Text>
        {person.muted && <MicOffIcon color={theme.warn} size={16} />}
      </View>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    tile: {
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 12,
      borderRadius: tokens.radiusLg,
      backgroundColor: theme.panel,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
    },
    ring: {
      // Drawn around the avatar without taking room from the tile.
      margin: -2 * RING,
      padding: RING,
      borderWidth: RING,
      borderColor: "transparent",
    },
    speaking: {
      borderColor: theme.ok,
    },
    name: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      maxWidth: "100%",
    },
    words: {
      flexShrink: 1,
      color: theme.text,
      fontSize: tokens.textBody,
      fontWeight: "600",
    },
  });
}
