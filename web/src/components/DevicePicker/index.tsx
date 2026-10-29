import {
  type DeviceKind,
  switchCamera,
  switchMicrophone,
} from "../../api/voice";
import { useDevices } from "../../hooks/useDevices";
import { Select } from "../Select";
import { CameraIcon, MicIcon } from "../VoiceIcons";
import { deviceRow, KIND_LABEL } from "./row";

// A row of the voice bar's device list: the microphone, or the camera.
// Underneath it is a native select dressed as a row — a small icon, the
// device's full name, a chevron when there is a choice — so the keyboard
// and the browser's own device menu are unchanged. Both rows are always
// rendered; what each says in its states is decided in row.ts, and one
// with nothing to choose is disabled rather than hidden. The list
// follows devices plugged in or unplugged mid-call.
export function DevicePicker({
  kind,
  enabled,
}: {
  kind: DeviceKind;
  enabled: boolean;
}) {
  const { devices, active } = useDevices(kind, enabled);
  const row = deviceRow(kind, enabled, devices, active);
  const label = KIND_LABEL[kind];
  const pick = kind === "audioinput" ? switchMicrophone : switchCamera;
  return (
    <Select
      className={`voice-device-row ${row.placeholder ? "placeholder" : ""}`}
      icon={kind === "audioinput" ? <MicIcon /> : <CameraIcon off={!enabled} />}
      chevron={row.opens}
      disabled={!row.opens}
      aria-label={label}
      title={row.text}
      value={row.opens ? (active ?? "") : row.text}
      onChange={(e) => pick(e.target.value)}
    >
      {row.opens ? (
        devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || label}
          </option>
        ))
      ) : (
        <option value={row.text}>{row.text}</option>
      )}
    </Select>
  );
}
