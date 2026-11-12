import { StyleSheet, Text, View } from "react-native";
import { useAlertPrefs, useSetServerAlerts } from "../../alertPrefs/AlertPrefsProvider";
import { serverAlerts } from "../../alertPrefs/prefs";
import Section from "../../components/Section";
import ServerTile from "../../components/ServerTile";
import { useServers } from "../../servers";
import { useWaiting } from "../../servers/useWaiting";
import { type Theme, tokens, useTheme } from "../../theme";
import SwitchRow from "./SwitchRow";

// Which saved servers may show a banner on this phone, each by its
// local ID (src/alertPrefs); the activity list and the badges count
// whatever these say. A server whose sign-in has ended has nothing to
// set, as on the You tab. Refused at the system, the group is drawn
// faded and held, with its values kept.
export default function ServerAlertsSection({ refused }: { refused: boolean }) {
  const styles = makeStyles(useTheme());
  const { servers } = useServers();
  // No current server here, so every one is asked, as the You tab asks the others.
  const { waiting } = useWaiting(servers, undefined);
  const [prefs] = useAlertPrefs();
  const setAlerts = useSetServerAlerts();
  return (
    <View style={styles.section}>
      <Section title="From these servers" dimmed={refused}>
        {servers.map((server, index) => {
          const ended = waiting[server.id]?.state === "ended";
          return (
            <SwitchRow
              key={server.id}
              label={server.name}
              leading={<ServerTile name={server.name} dim={ended} />}
              note={ended ? "Signed out" : undefined}
              divided={index > 0}
              value={serverAlerts(prefs, server.id)}
              disabled={refused}
              testID={`alert-server-${server.id}`}
              onValueChange={(on) => setAlerts(server.id, on)}
            />
          );
        })}
      </Section>
      <Text style={styles.caption}>Muted spaces, channels and threads never alert. Mute them from their own menus.</Text>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    section: {
      gap: 6,
    },
    caption: {
      marginHorizontal: 4,
      color: theme.textMuted,
      fontSize: tokens.textSm,
      lineHeight: tokens.textSm * tokens.leadingUi,
    },
  });
}
