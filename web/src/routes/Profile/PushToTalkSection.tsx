import { usePushToTalkStore } from "../../api/pushToTalk";
import { PUSH_TO_TALK_LABEL } from "../../api/shortcuts";
import { SettingRow } from "../../components/SettingRow";
import { Switch } from "../../components/Switch";

// Push to talk: whether the key listener is on. A choice about this device, so it
// is kept in this browser and says so. It also has to say that the key
// only works while Stoop has focus: a page gets no keys otherwise, and
// that is what would be reported as a bug.
export function PushToTalkSection() {
  const enabled = usePushToTalkStore((s) => s.enabled);
  const setEnabled = usePushToTalkStore((s) => s.setEnabled);
  return (
    <SettingRow
      id="push-to-talk"
      title="Push to talk"
      description={`While you're muted in a call, hold ${PUSH_TO_TALK_LABEL} to talk. Works only while Stoop is the focused window. Kept on this device.`}
    >
      <Switch
        id="push-to-talk"
        checked={enabled}
        onChange={(e) => setEnabled(e.target.checked)}
      />
    </SettingRow>
  );
}
