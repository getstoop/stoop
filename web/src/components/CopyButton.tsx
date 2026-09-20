import { useEffect, useState } from "react";
import { notice } from "../stores/dialogs";

// A "Copy" chip that says "Copied!" for a moment once the text is on the
// clipboard, and raises a notice when it can't get there.
export function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      notice({ title: "Couldn't copy to the clipboard" });
    }
  };

  return (
    <button type="button" className="chip" onClick={copy}>
      {copied ? "Copied!" : label}
    </button>
  );
}
