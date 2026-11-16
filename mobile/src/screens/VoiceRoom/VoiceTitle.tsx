import { StyleSheet, Text, View } from "react-native";
import { SpeakerIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";
import TitlePill, { TITLE_LINE, TITLE_SCALE } from "../Channel/TitlePill";
import { roomAbout } from "./stageRules";

// A voice room's title, in the header's pill as a channel's is
// (ChannelTitle): a speaker at the left, and beside it the room's name
// over its space and how many are in the room, once the roster says.
export default function VoiceTitle({
  name,
  spaceName,
  count,
}: {
  name: string;
  spaceName: string;
  count: number | undefined;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const about = roomAbout(spaceName, count);
  return (
    <TitlePill label={[name, "voice", spaceName, count === undefined ? null : `${count} here`].filter(Boolean).join(", ")}>
      <View style={styles.row}>
        <SpeakerIcon color={theme.textMuted} size={24} />
        <View style={styles.lines}>
          <Text style={styles.name} maxFontSizeMultiplier={TITLE_SCALE} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.about} maxFontSizeMultiplier={TITLE_SCALE} numberOfLines={1}>
            {about}
          </Text>
        </View>
      </View>
    </TitlePill>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    lines: {
      flexShrink: 1,
      gap: 1,
    },
    name: {
      ...TITLE_LINE,
      color: theme.text,
      fontSize: 17,
      fontWeight: "700",
    },
    about: {
      ...TITLE_LINE,
      color: theme.textMuted,
      fontSize: tokens.textSm,
    },
  });
}
