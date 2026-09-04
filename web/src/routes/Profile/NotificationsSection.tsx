import { useState } from "react";
import {
  desktopPermission,
  requestDesktopPermission,
  sendTestDesktopNotification,
} from "../../api/notifications";
import { SettingRow } from "../../components/SettingRow";

// Desktop banners: the browser permission, and a way to prove it works.
// It lives here rather than on the activity feed because the feed is a
// record and this is a setting.
export function NotificationsSection() {
  const [perm, setPerm] = useState(desktopPermission());
  return (
    <SettingRow
      title="Desktop notifications"
      description={
        <>
          {perm === "granted" &&
            "On — you'll get a native alert whenever someone mentions you."}
          {perm === "denied" &&
            "Blocked in the browser; allow notifications for this site to turn them on."}
          {perm === "insecure" &&
            "Browsers only allow desktop notifications over HTTPS (or on localhost). Put Stoop behind TLS to use them from other devices."}
          {perm === "unsupported" &&
            "This browser can't show desktop notifications."}
          {perm === "default" &&
            "Get a native alert whenever someone mentions you."}
        </>
      }
    >
      {perm === "granted" && (
        <>
          <button
            type="button"
            className="chip"
            onClick={sendTestDesktopNotification}
          >
            Send a test notification
          </button>
          <span className="muted small">
            Nothing? Check System Settings → Notifications for your browser.
          </span>
        </>
      )}
      {perm === "default" && (
        <button
          type="button"
          className="primary"
          onClick={async () => setPerm(await requestDesktopPermission())}
        >
          Enable desktop notifications
        </button>
      )}
    </SettingRow>
  );
}
