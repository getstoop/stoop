import { useEffect, useRef } from "react";
import { useLayoutStore } from "../stores/layout";
import { useVoiceStore } from "../stores/voice";
import { LivePopover } from "./LiveIndicator/LivePopover";
import { POPOVER_WIDTH } from "./LiveIndicator/position";

// The live indicator's popover when the desktop shell's strip opened it:
// centred just under the strip, where its pill sits.
export function ShellLivePopover() {
  const open = useLayoutStore((s) => s.shellLiveOpen);
  const setOpen = useLayoutStore((s) => s.setShellLiveOpen);
  const inVoice = useVoiceStore((s) => s.connection !== null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && !inVoice) setOpen(false);
  }, [open, inVoice, setOpen]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", close);
    };
  }, [open, setOpen]);

  if (!open || !inVoice) return null;
  const at = {
    top: 8,
    left: Math.max(8, (window.innerWidth - POPOVER_WIDTH) / 2),
  };
  return (
    <div ref={ref}>
      <LivePopover at={at} onClose={() => setOpen(false)} />
    </div>
  );
}
