import { useEffect } from "react";
import { createHold } from "../api/pushToTalk";
import { isPushToTalkPress, isPushToTalkRelease } from "../api/shortcuts";
import { setTransmitting } from "../api/voice";

// Watches the push to talk key while `on` (push to talk chosen, and in a
// call). A browser only gets keys while the page has focus, so anything
// that could take the keyup away shuts the mic.
export function usePushToTalk(on: boolean) {
  useEffect(() => {
    if (!on) return;
    // Opens and shuts in the order they were asked for: a quick tap must
    // not leave an open landing after its shut.
    let queue = Promise.resolve();
    const hold = createHold((open) => {
      queue = queue.then(() => setTransmitting(open));
    });
    const onDown = (e: KeyboardEvent) => {
      if (!isPushToTalkPress(e)) return;
      e.preventDefault();
      // A held key repeats keydown; press() only counts the first.
      hold.press();
    };
    const onUp = (e: KeyboardEvent) => {
      if (isPushToTalkRelease(e)) hold.release();
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") hold.cut();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", hold.cut);
    window.addEventListener("pagehide", hold.cut);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", hold.cut);
      window.removeEventListener("pagehide", hold.cut);
      document.removeEventListener("visibilitychange", onHidden);
      hold.cut();
    };
  }, [on]);
}
