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

// The name's plate, in web's fixed on-video palette (web/src/tokens.css
// --on-video-*), which no theme sets: once a tile carries video the
// plate is on the picture, and an avatar tile's matches so the plates on
// a mixed stage read as one set.
const ON_VIDEO = { fill: "rgba(0, 0, 0, 0.85)", text: "#e6e7ea", danger: "#ff8a80" };

// How far the name grows with the system's text size: past this it
// would reach the avatar on the smallest tile.
const NAME_SCALE = 1.5;

// One person on the Stage: their avatar in the middle of the tile and
// their name on a small plate in its lower left corner, as web's tile
// (web/src/styles/voice-stage.css .tile-name), with a muted microphone
// beside it for someone who has muted theirs. Read out as one thing. Whoever
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
      {/* The row bounds the plate, which is only as wide as its name. */}
      <View style={styles.name}>
        <View style={styles.plate}>
          <Text style={styles.words} maxFontSizeMultiplier={NAME_SCALE} numberOfLines={1}>
            {person.name}
          </Text>
          {person.muted && <MicOffIcon color={ON_VIDEO.danger} size={14} />}
        </View>
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
      left: 8,
      right: 8,
      bottom: 8,
      flexDirection: "row",
    },
    plate: {
      flexShrink: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingVertical: 3,
      paddingHorizontal: 8,
      borderRadius: tokens.radius,
      backgroundColor: ON_VIDEO.fill,
    },
    words: {
      flexShrink: 1,
      color: ON_VIDEO.text,
      fontSize: tokens.textUi,
      fontWeight: "600",
    },
  });
}
