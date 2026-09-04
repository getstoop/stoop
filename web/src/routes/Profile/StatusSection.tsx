import { setMyStatus } from "../../api/status";
import { SettingRow } from "../../components/SettingRow";
import { PresenceStatus } from "../../gen/stoop/realtime/v1/realtime_pb";
import { useConnectionStore } from "../../stores/connection";

const STATUSES: { value: PresenceStatus; label: string; cls: string }[] = [
  { value: PresenceStatus.ONLINE, label: "Online", cls: "online" },
  { value: PresenceStatus.AWAY, label: "Away", cls: "away" },
  { value: PresenceStatus.DND, label: "Do not disturb", cls: "dnd" },
];

// How the user appears to others while online. A browser-side choice,
// announced to the gateway (api/status.ts). It sits with notifications
// because Do not disturb is what silences them.
export function StatusSection() {
  const status = useConnectionStore((s) => s.myStatus);
  return (
    <SettingRow
      className="status-section"
      title="Status"
      description="How you appear to others while you're online. Away is set for you after ten idle minutes; Do not disturb also silences desktop alerts."
    >
      <div className="status-options">
        {STATUSES.map((o) => (
          <label
            key={o.value}
            className={`status-option ${status === o.value ? "active" : ""}`}
          >
            <input
              type="radio"
              name="status"
              value={o.value}
              checked={status === o.value}
              onChange={() => setMyStatus(o.value)}
            />
            <span className={`online-dot ${o.cls}`} aria-hidden="true" />
            {o.label}
          </label>
        ))}
      </div>
    </SettingRow>
  );
}
