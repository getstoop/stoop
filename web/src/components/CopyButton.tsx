import { useEffect, useState } from "react";
import { notice } from "../stores/dialogs";
import { CheckIcon, CopyIcon } from "./Icons";

// A "Copy" chip that says "Copied!" for a moment once the text is on the
// clipboard, and raises a notice when it can't get there. With icon, a
// copy glyph instead, which turns into a check.
export function CopyButton({
  text,
  label = "Copy",
  icon = false,
}: {
  text: string;
  label?: string;
  icon?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2500);
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

  if (icon) {
    return (
      <button
        type="button"
        className={`icon-button copy-button${copied ? " copied" : ""}`}
        onClick={copy}
        aria-label={copied ? "Copied" : label}
        title={copied ? "Copied" : label}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    );
  }
  return (
    <button type="button" className="chip" onClick={copy}>
      {copied ? "Copied!" : label}
    </button>
  );
}
