import { ConnectError } from "@connectrpc/connect";
import { type ChangeEvent, useRef, useState } from "react";
import { IMAGE_ACCEPT, readImageFile } from "../api/files";

// A "Choose image" button backed by a hidden file input. The caller does
// the upload; this component owns picking, the client-side size check,
// and showing whatever error comes back (the server's message for
// rejected bytes, e.g. a text file renamed .png).
export function ImagePicker({
  label,
  busyLabel = "Uploading…",
  onPick,
}: {
  label: string;
  busyLabel?: string;
  onPick: (bytes: Uint8Array) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Allow picking the same file again after an error.
    e.target.value = "";
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      await onPick(await readImageFile(file));
    } catch (err) {
      setError(err instanceof ConnectError ? err.rawMessage : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="image-picker">
      <input
        ref={input}
        type="file"
        accept={IMAGE_ACCEPT}
        onChange={change}
        hidden
        aria-label={label}
      />
      <button
        type="button"
        className="chip"
        onClick={() => input.current?.click()}
        disabled={busy}
      >
        {busy ? busyLabel : label}
      </button>
      {error && (
        <p className="error upload-error" role="alert">
          {error.replace(/^Error: /, "")}
        </p>
      )}
    </div>
  );
}
