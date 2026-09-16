import { type DeviceKind, switchCamera, switchMicrophone } from "../api/voice";
import { useDevices } from "../hooks/useDevices";

// A microphone or camera picker for the voice bar. Only shown when there
// is a choice to make; labels exist once the permission has been granted,
// which joining (or turning the camera on) does. The list follows devices
// plugged in or unplugged mid-call.
export function DevicePicker({
  kind,
  enabled,
}: {
  kind: DeviceKind;
  enabled: boolean;
}) {
  const { devices, active } = useDevices(kind, enabled);
  if (devices.length < 2) return null;
  const label = kind === "audioinput" ? "Microphone" : "Camera";
  const pick = kind === "audioinput" ? switchMicrophone : switchCamera;
  return (
    <select
      className="voice-mic-select"
      aria-label={label}
      title={label}
      value={active ?? ""}
      onChange={(e) => pick(e.target.value)}
    >
      {devices.map((d) => (
        <option key={d.deviceId} value={d.deviceId}>
          {d.label || label}
        </option>
      ))}
    </select>
  );
}
