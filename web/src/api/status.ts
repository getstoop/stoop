import { PresenceStatus } from "../gen/stoop/realtime/v1/realtime_pb";
import { useConnectionStore } from "../stores/connection";
import { onShellStatus, type PresenceChoice, shellStatus } from "./platform";
import { sendClientEvent } from "./ws";

// The user's own status. The choice (Online / Away / Do not disturb) is
// sent to the gateway after every Ready; others see it through
// PresenceChanged.
//
// Who makes the choice depends on what is hosting the page. In a browser
// it is a per-browser preference, and ten idle minutes report Away on top
// of it. Inside a desktop shell from bridge 3 on, the shell makes it once
// for every server it holds and decides idle from the computer itself —
// a person is away from their desk, not from one of their servers, and a
// page that is not in front cannot tell the difference.
// docs/architecture/desktop.md.

const KEY = "stoop.status";
const IDLE_AFTER_MS = 10 * 60 * 1000;

const FROM_SHELL: Record<PresenceChoice, PresenceStatus> = {
  online: PresenceStatus.ONLINE,
  away: PresenceStatus.AWAY,
  dnd: PresenceStatus.DND,
};

export function loadStatusPreference(): PresenceStatus {
  const fromShell = shellStatus();
  if (fromShell) return FROM_SHELL[fromShell];
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

// Follows the shell's choice for as long as the page is open: the shell
// decides for every server at once, including when to report Away, so
// there is nothing here to watch for but the next answer.
export function startShellStatusWatch(): () => void {
  return onShellStatus((status) => {
    useConnectionStore.getState().setMyStatus(FROM_SHELL[status]);
    announceStatus();
  });
}

// Watches for input; flips to idle after IDLE_AFTER_MS without any (or
// while the tab is hidden that long) and back on the first event. The
// browser's rule: see the note at the top of the file for why a shell
// that owns the status runs startShellStatusWatch instead.
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
