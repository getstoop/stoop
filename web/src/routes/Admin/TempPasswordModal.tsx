import { Modal } from "../../components/Modal";
import { OneTimeSecret } from "../../components/OneTimeSecret";

// After an admin resets someone's password: the temporary one, shown once,
// and what it means for the person, so the admin can tell them.
export function TempPasswordModal({
  username,
  password,
  onClose,
}: {
  username: string;
  password: string;
  onClose: () => void;
}) {
  return (
    <Modal
      title={`@${username}'s password was reset`}
      onClose={onClose}
      footer={
        <button type="button" className="primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="modal-body temp-password">
        <OneTimeSecret
          value={password}
          warning="Copy it now and pass it on. This is the only time it will be shown."
        />
        <div className="readout">
          What happens for them
          <ul>
            <li>
              They've been logged out everywhere, and their tokens stopped
              working.
            </li>
            <li>They log in with their username and this password.</li>
            <li>
              Then they choose a new one under Profile → Security → Change
              password.
            </li>
          </ul>
        </div>
      </div>
    </Modal>
  );
}
