import { useAlertPrefs } from "../../alertPrefs/AlertPrefsProvider";
import Section from "../../components/Section";
import SwitchRow from "./SwitchRow";

// Which kinds of activity show a banner on this phone, and whether a
// banner says the message. On the device alone (src/alertPrefs); the
// activity list and the badges count whatever these say. Refused at the
// system, they are drawn faded and held, with their values kept.
export default function AlertKindsSection({ refused }: { refused: boolean }) {
  const [prefs, change] = useAlertPrefs();
  return (
    <Section title="Alert this phone about" dimmed={refused}>
      <SwitchRow
        label="Mentions and replies"
        value={prefs.mentions}
        disabled={refused}
        testID="alert-mentions"
        onValueChange={(mentions) => change({ mentions })}
      />
      <SwitchRow
        label="Direct messages"
        divided
        value={prefs.directMessages}
        disabled={refused}
        testID="alert-direct-messages"
        onValueChange={(directMessages) => change({ directMessages })}
      />
      <SwitchRow
        label="New replies in threads I'm in"
        divided
        value={prefs.threads}
        disabled={refused}
        testID="alert-threads"
        onValueChange={(threads) => change({ threads })}
      />
      <SwitchRow
        label="Show message text"
        detail={'Off: "Someone mentioned you in Book club"'}
        divided
        value={prefs.showText}
        disabled={refused}
        testID="alert-show-text"
        onValueChange={(showText) => change({ showText })}
      />
    </Section>
  );
}
