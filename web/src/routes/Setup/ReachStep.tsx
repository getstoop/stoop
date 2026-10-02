import { useInstanceStatus } from "../../api/queries";
import { ReachabilityForm } from "../../components/ReachabilityForm";

// Step 3: how people reach the server. Skippable; it is also in Server admin.
export function ReachStep({ onDone }: { onDone: () => void }) {
  const { data: status } = useInstanceStatus();
  return (
    <div className="login-card bare">
      <p>
        <strong>How will people reach this server?</strong>
      </p>
      <p className="hint">
        Right now it's reachable on this machine and its network. Pick what
        you'll put in front of it so invite links point at the right address
        {status?.voiceAvailable ? " and voice knows how to get through" : ""}.
        You can change all of this later under Server admin.
      </p>
      <ReachabilityForm onSkip={onDone} />
    </div>
  );
}
