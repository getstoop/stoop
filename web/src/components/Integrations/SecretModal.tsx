import { serverOrigin } from "../../api/origin";
import { CopyButton } from "../CopyButton";
import { Modal } from "../Modal";

export type Secret =
  | { kind: "hook"; name: string; url: string }
  | { kind: "signing"; name: string; secret: string }
  | { kind: "token"; name: string; secret: string };

// The only time a hook URL, signing secret or bot token is shown: Stoop
// keeps a hash or the raw signing secret, and a fingerprint for lists.
export function SecretModal({
  secret,
  onClose,
}: {
  secret: Secret;
  onClose: () => void;
}) {
  const origin = serverOrigin() || window.location.origin;
  const value = secret.kind === "hook" ? secret.url : secret.secret;

  const example =
    secret.kind === "hook"
      ? `curl -d 'disk is full' ${value}`
      : secret.kind === "token"
        ? `curl -X POST ${origin}/stoop.chat.v1.ChatService/ListSpaces \\\n  -H "Authorization: Bearer $STOOP_TOKEN" \\\n  -H "Content-Type: application/json" -d '{}'`
        : `import hmac, hashlib, time\nt, v1 = (p.split("=")[1] for p in headers["Stoop-Signature"].split(","))\nmine = hmac.new(secret, f"{t}.".encode() + body, hashlib.sha256).hexdigest()\nassert hmac.compare_digest(mine, v1) and time.time() - int(t) < 300`;
  const title =
    secret.kind === "hook"
      ? `“${secret.name}” is ready`
      : secret.kind === "token"
        ? `“${secret.name}” is ready`
        : `Signing secret for “${secret.name}”`;
  const what =
    secret.kind === "hook"
      ? "Paste this URL into the tool that should post here. Anyone with it can post into this channel, so treat it like a password."
      : secret.kind === "token"
        ? "This token acts as the bot with only the permissions you gave it."
        : "Your receiver checks each delivery's Stoop-Signature with this.";

  return (
    <Modal
      title={title}
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
        <p className="hint">{what}</p>
        <div className="token-secret">
          <code data-secret>{value}</code>
          <CopyButton text={value} />
        </div>
        <div className="readout">
          {secret.kind === "signing" ? "Verifying it" : "Try it"}
          <pre className="token-example">{example}</pre>
        </div>
      </div>
    </Modal>
  );
}
