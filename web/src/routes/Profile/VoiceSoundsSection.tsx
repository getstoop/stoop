import { useVoiceCuesStore } from "../../api/voiceCues";

// The join and leave cues for the call you are in. A choice about this
// device's speakers, so it is kept in this browser and says so. Inside
// the desktop app the switch is the app's, and the whole Notifications
// tab is the app's with it, so this row is never drawn there.
//
// The box sits before its words rather than out in the control column,
// where a lone checkbox reads as stranded.
export function VoiceSoundsSection() {
  const enabled = useVoiceCuesStore((s) => s.enabled);
  const setEnabled = useVoiceCuesStore((s) => s.setEnabled);
  return (
    <div className="setting-row toggle">
      <input
        id="voice-cues"
        type="checkbox"
        checked={enabled}
        onChange={(e) => setEnabled(e.target.checked)}
      />
      <div className="setting-text">
        <label htmlFor="voice-cues">Voice room sounds</label>
        <div className="hint">
          A soft tone when someone joins or leaves the call you're in. Kept on
          this device.
        </div>
      </div>
    </div>
  );
}
