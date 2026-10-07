import { useCloseSidePanel } from "./context";

// What content shows in place of itself when it can no longer be read:
// the reader left the space, the thread was deleted.
export function SidePanelUnavailable({ message }: { message: string }) {
  const close = useCloseSidePanel();
  return (
    <div className="side-panel-unavailable">
      <p>{message}</p>
      <button type="button" className="chip" onClick={close}>
        Close
      </button>
    </div>
  );
}
