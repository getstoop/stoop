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
// With a choice to make it is a native select dressed as a row — a small
// icon, the device's full name, a chevron — so the keyboard and the
// browser's own device menu are unchanged. With nothing to choose it is
// plain words in the same row, not a disabled select: those leave the
// Tab order, read as "unavailable", and lose their tooltip, and the
// tooltip is what carries a long name the row has cut short. Both rows
// are always rendered; what each says in its states is decided in
// row.ts. The list follows devices plugged in or unplugged mid-call.
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
  // The placeholder words stand for a device that is not there, and the
  // camera's glyph is crossed for them: off, or not yet listed.
  const icon =
    kind === "audioinput" ? <MicIcon /> : <CameraIcon off={row.placeholder} />;
  if (!row.opens) {
    return (
      <div
        className={`voice-device-row ${row.placeholder ? "placeholder" : ""}`}
        title={row.text}
      >
        <span className="voice-device-icon">{icon}</span>
        <span className="voice-device-name">
          {/* A device's name alone says nothing of what it is for; the
              placeholders already name the kind. */}
          {!row.placeholder && (
            <span className="visually-hidden">{label}: </span>
          )}
          {row.text}
        </span>
      </div>
    );
  }
  const pick = kind === "audioinput" ? switchMicrophone : switchCamera;
  return (
    <Select
      className="voice-device-row"
      icon={icon}
      aria-label={label}
      title={row.text}
      value={active ?? ""}
      onChange={(e) => pick(e.target.value)}
    >
      {devices.map((d) => (
        <option key={d.deviceId} value={d.deviceId}>
          {d.label || label}
        </option>
      ))}
    </Select>
  );
}
