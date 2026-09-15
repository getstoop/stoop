import { useEffect, useState } from "react";
import {
  activeDevice,
  type DeviceKind,
  listDevices,
  onDevicesChanged,
} from "../api/voice";

// The devices of one kind on offer while enabled, and the one in use.
// Listed when enabled and again whenever the browser reports a change,
// so a headset plugged in mid-call is offered, and one unplugged is no
// longer shown as the one in use.
export function useDevices(kind: DeviceKind, enabled: boolean) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [active, setActive] = useState<string | undefined>();
  useEffect(() => {
    if (!enabled) {
      setDevices([]);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      listDevices(kind)
        .then((d) => {
          if (cancelled) return;
          setDevices(d);
          setActive(activeDevice(kind));
        })
        .catch(() => {});
    };
    refresh();
    const stop = onDevicesChanged(refresh);
    return () => {
      cancelled = true;
      stop();
    };
  }, [kind, enabled]);
  return { devices, active };
}
