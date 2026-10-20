import type { Channel } from "@stoop/gen/stoop/chat/v1/channel_pb";
import { StyleSheet, Text, View } from "react-native";
import { voiceNames } from "../../api/channels";
import { SpeakerIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";
import Face, { type Person } from "./Face";

// Faces shown before the names say the rest.
const MAX_FACES = 3;

// One voice room: its name, and while anyone is in it a Live mark, up to
// three of their faces and who they are in one line ("Priya and Theo + 5
// more"). people is undefined while the realtime socket isn't connected,
// and the room shows just its name. The phone can't join yet.
export default function VoiceRoom({
  channel,
  people,
  origin,
  token,
}: {
  channel: Channel;
  people: Person[] | undefined;
  origin: string;
  token: string;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const live = !!people && people.length > 0;
  const names = live ? voiceNames(people.map((person) => person.name)) : "";

  return (
    <View
      style={styles.room}
      accessible
      accessibilityLabel={[channel.name, "voice", live ? `${names} in it` : null].filter(Boolean).join(", ")}
    >
      <View style={styles.line}>
        <SpeakerIcon color={theme.textMuted} size={20} />
        <Text style={styles.name} numberOfLines={1}>
          {channel.name}
        </Text>
        {live && (
          <View style={styles.live}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>Live</Text>
          </View>
        )}
      </View>
      {live && (
        <>
          <View style={styles.people}>
            <View style={styles.faces}>
              {people.slice(0, MAX_FACES).map((person, index) => (
                <Face key={person.userId} person={person} origin={origin} token={token} first={index === 0} />
              ))}
            </View>
            <Text style={styles.names} numberOfLines={1}>
              {names}
            </Text>
          </View>
          <Text style={styles.note}>Join voice from the web or desktop app for now.</Text>
        </>
      )}
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    room: {
      gap: 6,
      paddingVertical: 12,
      paddingHorizontal: 12,
    },
    line: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 24,
    },
    name: {
      flex: 1,
      color: theme.text,
      fontSize: tokens.textBody,
    },
    live: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    liveDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.ok,
    },
    liveText: {
      color: theme.ok,
      fontSize: tokens.textSm,
      fontWeight: "600",
    },
    people: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingLeft: 32,
    },
    faces: {
      flexDirection: "row",
    },
    names: {
      flex: 1,
      color: theme.textMuted,
      fontSize: tokens.textUi,
    },
    note: {
      paddingLeft: 32,
      color: theme.textMuted,
      fontSize: tokens.textSm,
    },
  });
}
