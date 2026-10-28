import { VOLUME_KEYS_LABEL } from "../../api/shortcuts";
import { useVoiceVolumeStore } from "../../api/voiceVolume";
import { SettingRow } from "../../components/SettingRow";
import { Switch } from "../../components/Switch";

// The volume keys: whether Ctrl+Shift+Up and Down step the call's
// volume. A choice about this device, kept in this browser like push to
// talk, and like it only while Stoop has focus: a page gets no keys
// otherwise, and that is what would be reported as a bug.
export function VolumeKeysSection() {
  const enabled = useVoiceVolumeStore((s) => s.keys);
  const setKeys = useVoiceVolumeStore((s) => s.setKeys);
  return (
    <SettingRow
      id="volume-keys"
      title="Volume keys"
      description={`While you're in a call, ${VOLUME_KEYS_LABEL} turn the call up or down. Works only while Stoop is the focused window. Kept on this device.`}
    >
      <Switch
        id="volume-keys"
        checked={enabled}
        onChange={(e) => setKeys(e.target.checked)}
      />
    </SettingRow>
  );
}
