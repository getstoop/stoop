import type { ActivityItem } from "../gen/stoop/chat/v1/activity_pb";
import { activityVerb } from "./activity";

// Desktop banners: the browser's Notification API, and the rules for when
// a banner is worth firing. The feed itself lives in activity.ts.

// "Attention" means the user would see a change on screen right now: the
// tab is visible AND the window is focused. Two windows side by side are
// both visible, but only one has focus — the other should get an alert.
export function hasAttention(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

export function desktopNotificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export type DesktopPermission =
  | NotificationPermission
  | "unsupported"
  | "insecure";

// Browsers only expose the Notification API on HTTPS or localhost; over
// plain HTTP (e.g. a LAN IP) the request silently fails, so say so.
export function desktopPermission(): DesktopPermission {
  if (!desktopNotificationsSupported()) return "unsupported";
  if (!window.isSecureContext) return "insecure";
  return Notification.permission;
}

export async function requestDesktopPermission(): Promise<DesktopPermission> {
  const state = desktopPermission();
  if (state !== "default") return state;
  return Notification.requestPermission();
}

// Shows a desktop notification for an activity item (whether or not this
// window is focused — a native banner is still the clearest cue) unless
// the caller says to keep quiet (Do not disturb, a muted space, a DM being
// read as it arrives). Clicking it focuses the tab and jumps there.
export function maybeDesktopNotify(
  item: ActivityItem,
  path: string,
  quiet = false,
) {
  if (desktopPermission() !== "granted") return;
  if (quiet) return;
  const who = item.actor?.displayName || item.actor?.username || "Someone";
  showDesktopNotification(
    `${who} ${activityVerb(item.kind)}`,
    item.preview,
    item.id,
    path,
  );
}

// Fires a sample so the user can confirm the browser/OS plumbing works.
export function sendTestDesktopNotification() {
  showDesktopNotification(
    "Stoop notifications are working",
    "This is what a mention looks like.",
    "test",
    location.pathname,
  );
}

function showDesktopNotification(
  title: string,
  body: string,
  tag: string,
  path: string,
) {
  if (desktopPermission() !== "granted") return;
  // The same tag replaces an earlier banner (a refreshed DM entry keeps
  // its id); renotify makes the replacement alert again where supported.
  const options: NotificationOptions & { renotify?: boolean } = {
    body,
    tag,
    renotify: true,
  };
  const note = new Notification(title, options);
  note.onclick = () => {
    window.focus();
    if (location.pathname !== path) location.assign(path);
    note.close();
  };
}
