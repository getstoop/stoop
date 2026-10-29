import type { DeviceKind } from "../../api/voice";

// What a device row of the voice bar says, and whether it opens. Both
// rows are always in the bar (the bar keeps its height, and the mic row
// holds the level meter), so a row with nothing to choose
// still needs words: the one device's name, or the kind of device while
// the list is empty. The camera's list is empty until the camera has
// been on, because its labels need its permission, so off it says
// "Camera off" rather than a remembered name.
export type DeviceRow = {
  text: string;
  // Words standing in for a device, in muted text.
  placeholder: boolean;
  // Two or more devices: the row shows a chevron and opens the picker.
  opens: boolean;
};

export const KIND_LABEL: Record<DeviceKind, string> = {
  audioinput: "Microphone",
  videoinput: "Camera",
};

export function deviceRow(
  kind: DeviceKind,
  enabled: boolean,
  devices: Pick<MediaDeviceInfo, "deviceId" | "label">[],
  active?: string,
): DeviceRow {
  const label = KIND_LABEL[kind];
  if (kind === "videoinput" && !enabled)
    return { text: "Camera off", placeholder: true, opens: false };
  if (devices.length === 0)
    return { text: label, placeholder: true, opens: false };
  const current = devices.find((d) => d.deviceId === active) ?? devices[0];
  return {
    text: current.label || label,
    placeholder: false,
    opens: devices.length > 1,
  };
}
