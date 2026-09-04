import type { LiveKitStatus } from "../../gen/stoop/instance/v1/reachability_pb";
import { SettingRow } from "../SettingRow";

// A reading, not a field: whether the voice backend is up.
export function LiveKitSection({ lk }: { lk: LiveKitStatus | undefined }) {
  const running = lk?.running ?? false;
  return (
    <SettingRow
      className="reach-group reach-livekit"
      data-state={running ? "running" : "stopped"}
      heading
      title="LiveKit"
      description="LiveKit is the backend that supports voice and video for your Stoop instance. This should be running if voice is enabled for this instance."
    >
      <p className="reach-status">
        <span className={running ? "reach-ok" : "reach-bad"}>
          {running ? "Running" : "Stopped"}
        </span>
        {lk?.url ? (
          <>
            {" · "}
            <code>{lk.url}</code>
          </>
        ) : null}
      </p>
    </SettingRow>
  );
}
