import { PresenceStatus } from "../gen/stoop/realtime/v1/realtime_pb";
import { useConnectionStore } from "../stores/connection";
import { sendClientEvent } from "./ws";

// The user's own status. The choice (Online / Away / Do not disturb) is a
// per-browser preference, sent to the gateway after every Ready; on top
// of it, ten idle minutes report Away automatically and any activity
// reports the choice again. Others see it through PresenceChanged.

const KEY = "stoop.status";
const IDLE_AFTER_MS = 10 * 60 * 1000;

export function loadStatusPreference(): PresenceStatus {
  try {
    const v = Number(localStorage.getItem(KEY));
    if (v === PresenceStatus.AWAY || v === PresenceStatus.DND) return v;
  } catch {
    // no storage: online
  }
  return PresenceStatus.ONLINE;
}

let idle = false;

// What the gateway should show for us right now.
export function effectiveStatus(): PresenceStatus {
  const pref = useConnectionStore.getState().myStatus;
  return idle && pref === PresenceStatus.ONLINE ? PresenceStatus.AWAY : pref;
}

export function announceStatus() {
  sendClientEvent({
    payload: { case: "setStatus", value: { status: effectiveStatus() } },
  });
}

export function setMyStatus(status: PresenceStatus) {
  useConnectionStore.getState().setMyStatus(status);
  try {
    localStorage.setItem(KEY, String(status));
  } catch {
    // fine: the choice lasts for this page
  }
  announceStatus();
}

// Watches for input; flips to idle after IDLE_AFTER_MS without any (or
// while the tab is hidden that long) and back on the first event.
export function startIdleWatch(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const goIdle = () => {
    if (idle) return;
    idle = true;
    announceStatus();
  };
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(goIdle, IDLE_AFTER_MS);
  };
  const active = () => {
    if (idle) {
      idle = false;
      announceStatus();
    }
    arm();
  };
  const events = ["mousemove", "keydown", "pointerdown", "touchstart", "focus"];
  for (const e of events) window.addEventListener(e, active, { passive: true });
  const onVisible = () => {
    if (document.visibilityState === "visible") active();
  };
  document.addEventListener("visibilitychange", onVisible);
  arm();
  return () => {
    clearTimeout(timer);
    for (const e of events) window.removeEventListener(e, active);
    document.removeEventListener("visibilitychange", onVisible);
    idle = false;
  };
}

// CSS modifier and label for a status ("" / offline when not online).
export function presenceClass(status: PresenceStatus | undefined): string {
  switch (status) {
    case PresenceStatus.AWAY:
      return "away";
    case PresenceStatus.DND:
      return "dnd";
    default:
      return "online";
  }
}

export function presenceLabel(
  online: boolean,
  status: PresenceStatus | undefined,
): string {
  if (!online) return "offline";
  switch (status) {
    case PresenceStatus.AWAY:
      return "away";
    case PresenceStatus.DND:
      return "do not disturb";
    default:
      return "online";
  }
}
