import { serverOrigin } from "../../api/origin";
import { Modal } from "../../components/Modal";
import { OneTimeSecret } from "../../components/OneTimeSecret";

// The only time a personal token is shown: Stoop keeps its hash and last
// four characters, never the token.
export function TokenCreatedModal({
  name,
  secret,
  onClose,
}: {
  name: string;
  secret: string;
  onClose: () => void;
}) {
  const origin = serverOrigin() || window.location.origin;

  return (
    <Modal
      title={`“${name}” is ready`}
      onClose={onClose}
      footer={
        <button type="button" className="primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="modal-body token-form">
        <OneTimeSecret value={secret} />
        <div className="readout">
          Try it
          <pre className="token-example">
            {`curl -X POST ${origin}/stoop.chat.v1.ChatService/ListSpaces \\\n  -H "Authorization: Bearer $STOOP_TOKEN" \\\n  -H "Content-Type: application/json" -d '{}'`}
          </pre>
        </div>
      </div>
    </Modal>
  );
}
