import { useEffect } from "react";
import { createHold } from "../api/pushToTalk";
import { isPushToTalkPress, isPushToTalkRelease } from "../api/shortcuts";
import { mute, unmute } from "../api/voice";
import { useVoiceStore } from "../stores/voice";

// Listens for the push to talk key while `on` (push to talk chosen, and
// in a call). A page only gets keys while it has focus.
export function usePushToTalk(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const hold = createHold({
      muted: () => useVoiceStore.getState().muted,
      mute,
      unmute,
    });
    const onDown = (e: KeyboardEvent) => {
      if (!isPushToTalkPress(e)) return;
      e.preventDefault();
      // A held key repeats keydown. Only a fresh press starts a hold: a
      // repeat could otherwise undo a Mute clicked while the key is held.
      if (!e.repeat) hold.press();
    };
    const onUp = (e: KeyboardEvent) => {
      if (isPushToTalkRelease(e)) hold.release();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      hold.stop();
    };
  }, [on]);
}
