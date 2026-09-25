import { useVoiceCuesStore } from "../../api/voiceCues";
import { SettingRow } from "../../components/SettingRow";
import { Switch } from "../../components/Switch";

// The join and leave cues for the call you are in. A choice about this
// device's speakers, so it is kept in this browser and says so. Inside
// the desktop app the switch is the app's, and the whole Notifications
// tab is the app's with it, so this row is never drawn there.
export function VoiceSoundsSection() {
  const enabled = useVoiceCuesStore((s) => s.enabled);
  const setEnabled = useVoiceCuesStore((s) => s.setEnabled);
  return (
    <SettingRow
      id="voice-cues"
      title="Voice room sounds"
      description="A soft tone when someone joins or leaves the call you're in. Kept on this device."
    >
      <Switch
        id="voice-cues"
        checked={enabled}
        onChange={(e) => setEnabled(e.target.checked)}
      />
    </SettingRow>
  );
}
