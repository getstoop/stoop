import { CopyButton } from "../../components/CopyButton";
import { Modal } from "../../components/Modal";

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
        <p className="callout warn">
          Copy it now and pass it on. This is the only time it will be shown.
        </p>
        <div className="temp-password-secret">
          <code data-temp-password>{password}</code>
          <CopyButton text={password} icon />
        </div>
        <div className="readout">
          What happens for them
          <ul>
            <li>
              They've been logged out everywhere, and their personal tokens have
              stopped working.
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
