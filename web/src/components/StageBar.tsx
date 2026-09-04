import { useCallback, useEffect, useRef, useState } from "react";
import { VoiceActions } from "./VoiceActions";
import { ChatIcon, FullscreenIcon } from "./VoiceIcons";

// The controls over the stage: the same row the sidebar carries
// (VoiceActions), plus the two that belong to the stage itself. It is
// not a convenience — the sidebar goes away in full screen, and with it
// went every way to mute or leave.
//
// It sits on the video, so it fades once you stop moving and comes back
// on the next pointer move or when something in it takes focus. Faded it
// is click-through, but still tabbable: the focus that lands on it is
// what brings it back, so the keyboard never chases an invisible button.
const IDLE_MS = 2500;

export function StageBar({
  stageRef,
  chatHidden,
  onToggleChat,
  onFullscreen,
}: {
  stageRef: React.RefObject<HTMLElement | null>;
  chatHidden: boolean;
  onToggleChat: () => void;
  onFullscreen: () => void;
}) {
  const [visible, setVisible] = useState(true);
  const barRef = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const held = useRef(false);
  // Show it and restart the countdown; while focus is inside there is no
  // countdown to restart.
  const wake = useCallback(() => {
    setVisible(true);
    clearTimeout(timer.current);
    if (held.current) return;
    timer.current = window.setTimeout(() => setVisible(false), IDLE_MS);
  }, []);
  useEffect(() => {
    const stage = stageRef.current;
    const bar = barRef.current;
    if (!stage || !bar) return;
    const hold = () => {
      held.current = true;
      wake();
    };
    const release = () => {
      held.current = false;
      wake();
    };
    // Pointer moves are watched on the whole stage rather than the bar:
    // the bar is what we are trying to bring back, so it can't be the
    // thing you have to find first.
    stage.addEventListener("pointermove", wake);
    bar.addEventListener("focusin", hold);
    bar.addEventListener("focusout", release);
    wake();
    return () => {
      stage.removeEventListener("pointermove", wake);
      bar.removeEventListener("focusin", hold);
      bar.removeEventListener("focusout", release);
      clearTimeout(timer.current);
    };
  }, [stageRef, wake]);

  return (
    <div ref={barRef} className={`stage-bar ${visible ? "" : "idle"}`}>
      <VoiceActions
        extras={
          <>
            <button
              type="button"
              className="icon-button"
              onClick={onToggleChat}
              aria-pressed={chatHidden}
              aria-label={chatHidden ? "Show chat" : "Hide chat"}
              title={chatHidden ? "Show chat" : "Hide chat"}
            >
              <ChatIcon off={chatHidden} />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={onFullscreen}
              aria-label="Full screen"
              title="Full screen"
            >
              <FullscreenIcon />
            </button>
          </>
        }
      />
    </div>
  );
}
