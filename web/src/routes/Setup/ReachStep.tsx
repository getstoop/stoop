import { useState } from "react";
import { useVoiceAvailable } from "../../api/queries";
import { ReachabilityForm } from "../../components/ReachabilityForm";
import type { StepState } from "./steps";

// How people reach the server. Skippable; it is also in Server admin.
// Done once anything was saved, skipped otherwise.
export function ReachStep({ onDone }: { onDone: (state: StepState) => void }) {
  const voiceAvailable = useVoiceAvailable();
  const [saved, setSaved] = useState(false);
  return (
    <div className="login-card bare">
      <p>
        <strong>How will people reach this server?</strong>
      </p>
      <p className="hint">
        Right now it's reachable on this machine and its network. Pick what
        you'll put in front of it so invite links point at the right address
        {voiceAvailable ? " and voice knows how to get through" : ""}. You can
        change all of this later under Server admin.
      </p>
      <ReachabilityForm
        onSaved={() => setSaved(true)}
        onSkip={() => onDone(saved ? "done" : "skipped")}
      />
    </div>
  );
}
