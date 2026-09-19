import { useState } from "react";
import { serverOrigin } from "../../api/origin";
import { Modal } from "../../components/Modal";

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
  const [copied, setCopied] = useState(false);
  const origin = serverOrigin() || window.location.origin;

  const copy = async () => {
    await navigator.clipboard?.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

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
        <p className="callout warn">
          Copy it now. This is the only time it will be shown.
        </p>
        <div className="token-secret">
          <code data-token-secret>{secret}</code>
          <button type="button" className="chip" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="field">
          Try it
          <pre className="token-example">
            {`curl -X POST ${origin}/stoop.chat.v1.ChatService/ListSpaces \\\n  -H "Authorization: Bearer $STOOP_TOKEN" \\\n  -H "Content-Type: application/json" -d '{}'`}
          </pre>
        </div>
      </div>
    </Modal>
  );
}
